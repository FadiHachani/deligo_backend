import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private readonly uploadDir = path.join(process.cwd(), 'uploads', 'avatars');

  constructor() {
    fs.mkdirSync(this.uploadDir, { recursive: true });
  }

  async compressAndSaveAvatar(file: Express.Multer.File): Promise<string> {
    const filename = `${uuidv4()}.webp`;
    const filepath = path.join(this.uploadDir, filename);

    await sharp(file.buffer)
      .resize(300, 300, { fit: 'cover' })
      .webp({ quality: 80 })
      .toFile(filepath);

    return `/uploads/avatars/${filename}`;
  }

  deleteFile(relativePath: string): void {
    const filepath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }
}
