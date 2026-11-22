import { Module } from '@nestjs/common';
import { GameController } from './game/game.controller.js';
import { GameService } from './game/game.service.js';
import { PlayerStore } from './game/player.store.js';

@Module({
  controllers: [GameController],
  providers: [PlayerStore, GameService],
})
export class AppModule {}
