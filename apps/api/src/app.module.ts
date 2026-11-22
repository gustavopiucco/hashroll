import { Module } from '@nestjs/common';
import { HouseService } from './house/house.service.js';
import { PlayersController } from './house/players.controller.js';
import { SettlerService } from './house/settler.service.js';

@Module({
  controllers: [PlayersController],
  providers: [HouseService, SettlerService],
})
export class AppModule {}
