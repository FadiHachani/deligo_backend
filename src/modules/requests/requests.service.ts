import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransportRequest } from '../../entities/transport-request.entity';
import { DriverProfile } from '../../entities/driver-profile.entity';
import { H3Service, H3_RESOLUTION_FINE } from '../../common/h3/h3.service';
import { UploadService } from '../../common/upload/upload.service';
import { RequestStatus, UserRole } from '../../common/enums';
import { assertTransition } from '../../common/state-machine';
import { CreateRequestDto } from './dto/create-request.dto';
import { ListRequestsDto } from './dto/list-requests.dto';

@Injectable()
export class RequestsService {
  constructor(
    @InjectRepository(TransportRequest)
    private readonly requestRepo: Repository<TransportRequest>,
    @InjectRepository(DriverProfile)
    private readonly driverProfileRepo: Repository<DriverProfile>,
    private readonly h3Service: H3Service,
    private readonly uploadService: UploadService,
  ) {}

  async create(clientId: string, dto: CreateRequestDto, files: Express.Multer.File[]) {
    const pickup_h3_index = this.h3Service.latLngToH3(
      dto.pickup_lat,
      dto.pickup_lng,
      H3_RESOLUTION_FINE,
    );
    const dropoff_h3_index = this.h3Service.latLngToH3(
      dto.dropoff_lat,
      dto.dropoff_lng,
      H3_RESOLUTION_FINE,
    );

    const photo_urls = await this.uploadService.compressAndSaveItemPhotos(files);

    const req = this.requestRepo.create({
      client_id: clientId,
      pickup_lat: dto.pickup_lat,
      pickup_lng: dto.pickup_lng,
      pickup_h3_index,
      dropoff_lat: dto.dropoff_lat,
      dropoff_lng: dto.dropoff_lng,
      dropoff_h3_index,
      item_category: dto.item_category,
      description: dto.description,
      scheduled_at: dto.scheduled_at ? new Date(dto.scheduled_at) : null,
      photo_urls,
    });

    return this.requestRepo.save(req);
  }

  async list(userId: string, role: UserRole, dto: ListRequestsDto) {
    const { status, page, limit } = dto;

    const qb = this.requestRepo
      .createQueryBuilder('req')
      .leftJoinAndSelect('req.client', 'client')
      .orderBy('req.created_at', 'DESC');

    if (role === UserRole.CLIENT) {
      qb.where('req.client_id = :userId', { userId });
    } else if (role === UserRole.DRIVER) {
      qb.where('req.status IN (:...statuses)', {
        statuses: [RequestStatus.OPEN, RequestStatus.BIDDING],
      });
    }
    // ADMIN: no filter

    if (status) {
      if (role === UserRole.DRIVER) {
        // override open/bidding filter with explicit status if provided
        qb.andWhere('req.status = :status', { status });
      } else {
        qb.andWhere('req.status = :status', { status });
      }
    }

    const total = await qb.getCount();
    const items = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    // For drivers, compute h3 distance
    if (role === UserRole.DRIVER) {
      const driverProfile = await this.driverProfileRepo.findOne({
        where: { user_id: userId },
      });
      return {
        items: items.map((r) => ({
          ...r,
          distance_h3:
            driverProfile?.current_h3_index
              ? (() => {
                  try {
                    return this.h3Service.h3Distance(
                      driverProfile.current_h3_index!,
                      r.pickup_h3_index,
                    );
                  } catch {
                    return null;
                  }
                })()
              : null,
        })),
        total,
        page,
        limit,
      };
    }

    return { items, total, page, limit };
  }

  async findOne(requestId: string, userId: string, role: UserRole) {
    const req = await this.requestRepo.findOne({
      where: { id: requestId },
      relations: ['bids', 'client'],
    });
    if (!req) throw new NotFoundException('Request not found');

    if (
      role === UserRole.CLIENT &&
      req.client_id !== userId
    ) {
      throw new ForbiddenException('Access denied');
    }

    return req;
  }

  async cancel(requestId: string, clientId: string) {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');
    if (req.client_id !== clientId)
      throw new ForbiddenException('Access denied');

    assertTransition(req.status, RequestStatus.CANCELLED);
    req.status = RequestStatus.CANCELLED;
    return this.requestRepo.save(req);
  }

  async updateStatus(requestId: string, newStatus: RequestStatus) {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');
    assertTransition(req.status, newStatus);
    req.status = newStatus;
    return this.requestRepo.save(req);
  }

  async findById(requestId: string) {
    const req = await this.requestRepo.findOne({ where: { id: requestId } });
    if (!req) throw new NotFoundException('Request not found');
    return req;
  }
}
