import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private readonly avatarDir = path.join(process.cwd(), 'uploads', 'avatars');
  private readonly itemPhotosDir = path.join(process.cwd(), 'uploads', 'items');

  constructor() {
    fs.mkdirSync(this.avatarDir, { recursive: true });
    fs.mkdirSync(this.itemPhotosDir, { recursive: true });
  }

  async compressAndSaveAvatar(file: Express.Multer.File): Promise<string> {
    const filename = `${uuidv4()}.webp`;
    const filepath = path.join(this.avatarDir, filename);

    await sharp(file.buffer)
      .resize(300, 300, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(filepath);

    return `/uploads/avatars/${filename}`;
  }

  async compressAndSaveItemPhoto(file: Express.Multer.File): Promise<string> {
    const filename = `${uuidv4()}.webp`;
    const filepath = path.join(this.itemPhotosDir, filename);

    await sharp(file.buffer)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(filepath);

    return `/uploads/items/${filename}`;
  }

  async compressAndSaveItemPhotos(files: Express.Multer.File[]): Promise<string[]> {
    return Promise.all(files.map((file) => this.compressAndSaveItemPhoto(file)));
  }

  deleteFile(relativePath: string): void {
    const filepath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }
}
