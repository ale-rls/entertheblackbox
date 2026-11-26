import { mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PocketBaseClient } from "../persistence/pocketbase-client.js";

/** The show's AI voice ("Enniah"), as used for every recorded voice cue. */
export const ENNIAH_VOICE_ID = "baebHbhnJ9ASPPp11oEY";
const SAMPLE_RATE = 48_000;
export const ANNOUNCEMENT_TEXT_MAX = 2_000;

export type Announcement = { id: string; text: string; durationMs: number; createdAt: string };
export type GeneratedVoice = { wav: Uint8Array; durationMs: number };

/** Wraps 16-bit mono PCM in a WAV header, so the display plays it without an encoder on the server. */
export function pcmToWav(pcm: Uint8Array, sampleRate = SAMPLE_RATE): Uint8Array {
  const wav = new Uint8Array(44 + pcm.byteLength);
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i)); };
  ascii(0, "RIFF"); view.setUint32(4, 36 + pcm.byteLength, true); ascii(8, "WAVE");
  ascii(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, "data"); view.setUint32(40, pcm.byteLength, true);
  wav.set(pcm, 44);
  return wav;
}

/** Speaks `text` with the Enniah voice (ElevenLabs v3, German, 48 kHz). Delivery tags like `[amused]` steer it and are not spoken. */
export function elevenLabsVoice(apiKey: string, voiceId = ENNIAH_VOICE_ID, fetchImpl: typeof fetch = fetch) {
  return async (text: string): Promise<GeneratedVoice> => {
    const response = await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=pcm_48000`, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_v3", language_code: "de" }),
      signal: AbortSignal.timeout(90_000),
    });
    if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const pcm = new Uint8Array(await response.arrayBuffer());
    if (pcm.byteLength < 2) throw new Error("ElevenLabs returned no audio");
    const even = pcm.byteLength % 2 === 0 ? pcm : pcm.subarray(0, pcm.byteLength - 1);
    return { wav: pcmToWav(even), durationMs: Math.max(1, Math.round(even.byteLength / 2 / SAMPLE_RATE * 1000)) };
  };
}

export interface AnnouncementStore {
  list(): Promise<Announcement[]>;
  create(text: string, voice: GeneratedVoice): Promise<Announcement>;
  remove(id: string): Promise<void>;
  /** Makes sure the clip's file is in the local media folder; returns its public URL path. */
  ensureLocal(id: string): Promise<{ announcement: Announcement; url: string }>;
}

type AnnouncementRecord = { id: string; text: string; durationMs: number; created: string; file: string; collectionId: string; collectionName: string };
const COLLECTION = "announcements";
const ID_PATTERN = /^[a-z0-9]{1,30}$/;

/**
 * Clips live in their own superuser-only PocketBase collection, not the
 * Studio media library: a change to `media` restarts the server mid-show.
 * The server keeps a copy under `<mediaDir>/announcements/` and serves it at
 * `/media/announcements/<id>.wav`.
 */
export class PocketbaseAnnouncementStore implements AnnouncementStore {
  constructor(private readonly client: PocketBaseClient, private readonly mediaDir: string, private readonly fetchImpl: typeof fetch = fetch) {}

  private dir() { return join(this.mediaDir, "announcements"); }
  private path(id: string) { return join(this.dir(), `${id}.wav`); }
  private toAnnouncement(record: AnnouncementRecord): Announcement {
    return { id: record.id, text: record.text, durationMs: record.durationMs, createdAt: record.created };
  }

  async list(): Promise<Announcement[]> {
    await this.client.ensureAuth();
    const records = await this.client.pb.collection<AnnouncementRecord>(COLLECTION).getFullList({ sort: "-created", requestKey: null });
    return records.map((record) => this.toAnnouncement(record));
  }

  async create(text: string, voice: GeneratedVoice): Promise<Announcement> {
    await this.client.ensureAuth();
    const file = new File([voice.wav], "announcement.wav", { type: "audio/wav" });
    const record = await this.client.pb.collection<AnnouncementRecord>(COLLECTION).create({ text, durationMs: voice.durationMs, file }, { requestKey: null });
    await this.writeLocal(record.id, voice.wav);
    return this.toAnnouncement(record);
  }

  async remove(id: string): Promise<void> {
    if (!ID_PATTERN.test(id)) throw new Error("not_found");
    await this.client.ensureAuth();
    await this.client.pb.collection(COLLECTION).delete(id, { requestKey: null });
    // The local copy stays harmlessly until the next deploy; nothing lists it.
  }

  async ensureLocal(id: string): Promise<{ announcement: Announcement; url: string }> {
    if (!ID_PATTERN.test(id)) throw new Error("not_found");
    await this.client.ensureAuth();
    const record = await this.client.pb.collection<AnnouncementRecord>(COLLECTION).getOne(id, { requestKey: null });
    const local = await stat(this.path(id)).catch(() => null);
    if (!local?.isFile() || local.size === 0) {
      const token = await this.client.pb.files.getToken({ requestKey: null });
      const response = await this.fetchImpl(this.client.pb.files.getURL(record, record.file, { token }));
      if (!response.ok) throw new Error(`Downloading announcement failed (${response.status})`);
      await this.writeLocal(id, new Uint8Array(await response.arrayBuffer()));
    }
    return { announcement: this.toAnnouncement(record), url: `/media/announcements/${id}.wav` };
  }

  private async writeLocal(id: string, bytes: Uint8Array) {
    await mkdir(this.dir(), { recursive: true });
    const temporary = `${this.path(id)}.download`;
    await writeFile(temporary, bytes);
    await rename(temporary, this.path(id));
  }
}

export type PlayingAnnouncement = { id: string; url: string; startedAt: number; durationMs: number };
