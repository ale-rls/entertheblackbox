#!/usr/bin/env node
/**
 * Generate the display's crowd-reaction one-shots with ElevenLabs Sound FX.
 *
 * Usage:
 *   ELEVENLABS_API_KEY=... pnpm generate-crowd-sfx
 *
 * The API returns MP3 directly. Files are bundled as static display assets;
 * they are deliberately separate from show-authored PocketBase media.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const effects = [
  {
    file: "crowd-applause-01.mp3",
    durationSeconds: 2.8,
    text: "Small indoor theatre audience, warm spontaneous applause with two delighted cheers, natural crowd, no speech, clean one-shot recording",
  },
  {
    file: "crowd-applause-02.mp3",
    durationSeconds: 3.4,
    text: "Ancient amphitheatre crowd erupts into enthusiastic clapping and cheering, lively human audience, a few whoops, no distinct words, clean one-shot",
  },
  {
    file: "crowd-applause-03.mp3",
    durationSeconds: 2.5,
    text: "Mixed theatre audience gives quick rhythmic applause with scattered happy cheers, intimate room perspective, no speech, clean one-shot",
  },
  {
    file: "crowd-boo-01.mp3",
    durationSeconds: 2.7,
    text: "Indoor theatre audience booing in disapproval, layered human crowd with low jeers and groans, no distinct words, clean one-shot recording",
  },
  {
    file: "crowd-boo-02.mp3",
    durationSeconds: 3.3,
    text: "Ancient amphitheatre crowd reacts with loud boos, jeers and disappointed groans, energetic but believable, no distinct words, clean one-shot",
  },
  {
    file: "crowd-boo-03.mp3",
    durationSeconds: 2.4,
    text: "Mixed audience gives playful theatrical booing and disapproving murmurs, intimate venue, no clear speech, clean one-shot recording",
  },
] as const;

const outDir = resolve(process.cwd(), "apps/display/public/sfx");

async function main() {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is required");
  }

  await mkdir(outDir, { recursive: true });

  for (const effect of effects) {
    const response = await fetch(
      "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: effect.text,
          duration_seconds: effect.durationSeconds,
          prompt_influence: 0.35,
          loop: false,
          model_id: "eleven_text_to_sound_v2",
        }),
      },
    );
    if (!response.ok) {
      throw new Error(`ElevenLabs failed for ${effect.file}: ${response.status} ${await response.text()}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    await writeFile(resolve(outDir, effect.file), bytes);
    console.log(`generated ${effect.file} (${bytes.byteLength} bytes)`);
  }
}

void main();
