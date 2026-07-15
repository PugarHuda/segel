// Shared narration plumbing for the recorders: neural VO (edge-tts) + an audio track
// that lines up exactly with a captured frame sequence.
//
// The timing contract: beats run sequentially, each beat dwells >= its clip length, and
// each audio segment = clip + trailing silence padded to that beat's measured wall time.
// Concatenating the segments in order therefore lands every word on its own beat.
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

export const FFMPEG = process.env.FFMPEG || "C:\\Hackathons\\Hackathon Stellar Real World ZK\\tools\\bin\\ffmpeg.exe";
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Duration in seconds of any media file, parsed off ffmpeg's stderr (no ffprobe here). */
export function durOf(file) {
  const r = spawnSync(FFMPEG, ["-i", file], { encoding: "utf8" });
  const m = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(r.stderr || "");
  return m ? +m[1] * 3600 + +m[2] * 60 + parseFloat(m[3]) : 0;
}

/** Synthesize one mp3 per beat; annotates each beat with {mp3, clipDur}. */
export function synth(beats, voice, audDir, log = console.log) {
  log(`synthesizing ${beats.length} VO clips with ${voice}…`);
  beats.forEach((b, i) => {
    const mp3 = `${audDir}\\clip${String(i).padStart(2, "0")}.mp3`;
    const r = spawnSync("python", ["-m", "edge_tts", "--voice", voice, "--text", b.t, "--write-media", mp3], { encoding: "utf8" });
    if (r.status !== 0) throw new Error("edge-tts failed: " + (r.stderr || "").slice(0, 200));
    b.mp3 = mp3;
    b.clipDur = durOf(mp3);
    log(`  clip ${i} ${b.clipDur.toFixed(1)}s`);
  });
  return beats;
}

/**
 * Build one wav whose timeline matches the capture.
 * @param starts ms offsets of each beat from capture start; @param tEnd total capture ms.
 */
export function buildTrack(beats, starts, tEnd, audDir) {
  const bounds = [...starts, tEnd];
  const list = beats.map((b, i) => {
    const segMs = bounds[i + 1] - bounds[i];
    const seg = `${audDir}\\seg${String(i).padStart(2, "0")}.wav`;
    const lead = i === 0 ? bounds[0] : 0; // silence before the first spoken word
    spawnSync(FFMPEG, ["-y", "-i", b.mp3,
      "-af", `adelay=${lead}|${lead},apad,atrim=0:${(segMs / 1000).toFixed(3)}`,
      "-ar", "44100", "-ac", "2", seg], { stdio: "ignore" });
    return `file '${seg.replace(/\\/g, "/")}'`;
  });
  const listFile = `${audDir}\\concat.txt`;
  writeFileSync(listFile, list.join("\n"));
  const out = `${audDir}\\narration.wav`;
  spawnSync(FFMPEG, ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", out], { stdio: "ignore" });
  return out;
}

/** Encode a png frame sequence + narration into an mp4. */
export function mux(framesDir, narration, out, fps) {
  const r = spawnSync(FFMPEG, ["-y",
    "-framerate", String(fps), "-i", `${framesDir}\\f%05d.png`,
    "-i", narration,
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-vf", "scale=1280:-2",
    "-c:a", "aac", "-b:a", "160k", "-shortest", out], { stdio: "ignore" });
  return r.status === 0;
}

/**
 * Join clips end to end. Re-encodes through the concat FILTER (not the demuxer) so
 * inputs with different fps/sample rates still splice cleanly.
 */
export function joinClips(clips, out, fps = 8) {
  const args = ["-y"];
  clips.forEach((c) => args.push("-i", c));
  const chains = clips.map((_, i) =>
    `[${i}:v]fps=${fps},scale=1280:800:force_original_aspect_ratio=decrease,pad=1280:800:(ow-iw)/2:(oh-ih)/2,setsar=1[v${i}];[${i}:a]aresample=44100[a${i}]`).join(";");
  const legs = clips.map((_, i) => `[v${i}][a${i}]`).join("");
  args.push("-filter_complex", `${chains};${legs}concat=n=${clips.length}:v=1:a=1[v][a]`,
    "-map", "[v]", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", out);
  return spawnSync(FFMPEG, args, { stdio: "ignore" }).status === 0;
}
