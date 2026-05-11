import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class UploadService {
  private readonly avatarDir = path.join(process.cwd(), 'uploads', 'avatars');
  private readonly itemPhotosDir = path.join(process.cwd(), 'uploads', 'items');
  // Delivery-proof + client-confirmation photos. Kept separate from item
  // photos so retention policies / cleanup jobs can treat them differently
  // (e.g. proofs may need longer retention for dispute resolution).
  private readonly deliveryPhotosDir = path.join(
    process.cwd(),
    'uploads',
    'deliveries',
  );

  constructor() {
    fs.mkdirSync(this.avatarDir, { recursive: true });
    fs.mkdirSync(this.itemPhotosDir, { recursive: true });
    fs.mkdirSync(this.deliveryPhotosDir, { recursive: true });
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

  // Used for both the driver's proof-of-delivery photo and the client's
  // receipt-confirmation photo. Same compression as item photos.
  async compressAndSaveDeliveryPhoto(
    file: Express.Multer.File,
  ): Promise<string> {
    const filename = `${uuidv4()}.webp`;
    const filepath = path.join(this.deliveryPhotosDir, filename);

    await sharp(file.buffer)
      .resize(800, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(filepath);

    return `/uploads/deliveries/${filename}`;
  }

  deleteFile(relativePath: string): void {
    const filepath = path.join(process.cwd(), relativePath);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
    }
  }
}
