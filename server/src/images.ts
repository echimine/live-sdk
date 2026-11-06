import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Readable } from "node:stream";
import { opaqueId } from "./ids.js";

/** Formats d'image reconnus, et l'extension de leurs fichiers. */
const EXTENSIONS = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export type ImageType = keyof typeof EXTENSIONS;

const TYPE_OF_EXTENSION = Object.fromEntries(
  Object.entries(EXTENSIONS).map(([type, extension]) => [extension, type as ImageType]),
);

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Nom d'un fichier d'image enregistré : rien d'autre n'est servi (ni `..`, ni `/`). */
const IMAGE_NAME = /^img_[a-z0-9]{16}\.(jpg|png|webp)$/;

/** Format d'une image d'après ses premiers octets, quel que soit le type annoncé. */
export function sniffImageType(bytes: Buffer): ImageType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (bytes.length >= 12 && bytes.toString("latin1", 0, 4) === "RIFF" && bytes.toString("latin1", 8, 12) === "WEBP") {
    return "image/webp";
  }
  return undefined;
}

/**
 * Images du Produit épinglé, dans un dossier (volume en production), servies
 * par le serveur commun sous `{publicUrl}/v1/images/{nom}`.
 */
export class ImageStore {
  constructor(
    private readonly dir: string,
    private readonly publicUrl: string,
  ) {}

  /** Enregistre une image déjà vérifiée et rend son URL publique. */
  async save(bytes: Buffer, type: ImageType): Promise<string> {
    await mkdir(this.dir, { recursive: true });
    const name = `${opaqueId("img_", 16)}.${EXTENSIONS[type]}`;
    await writeFile(join(this.dir, name), bytes, { flag: "wx" });
    return `${this.publicUrl.replace(/\/+$/, "")}/v1/images/${name}`;
  }

  /** Ouvre une image enregistrée ; `undefined` si le nom est invalide ou le fichier absent. */
  async open(name: string): Promise<{ stream: Readable; type: ImageType; size: number } | undefined> {
    if (!IMAGE_NAME.test(name)) return undefined;
    const path = join(this.dir, name);
    const info = await stat(path).catch(() => undefined);
    if (!info?.isFile()) return undefined;
    const type = TYPE_OF_EXTENSION[name.slice(name.lastIndexOf(".") + 1)]!;
    return { stream: createReadStream(path), type, size: info.size };
  }
}
