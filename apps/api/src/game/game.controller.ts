import { BadRequestException, Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { GameService, type BetInput } from './game.service.js';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

function addr(a: string): string {
  if (!ADDRESS_RE.test(a)) throw new BadRequestException('invalid address');
  return a;
}

/**
 * ⚠️ MVP WITHOUT AUTHENTICATION: anyone can bet on behalf of any address.
 * Roadmap phase 2: Sign-In With Ethereum (EIP-4361) + session stored in Postgres.
 */
@Controller('players/:address')
export class GameController {
  constructor(private readonly game: GameService) {}

  @Get()
  state(@Param('address') address: string) {
    return this.game.publicState(addr(address));
  }

  @Get('bets')
  bets(@Param('address') address: string) {
    return this.game.history(addr(address));
  }

  @Post('dice')
  dice(@Param('address') address: string, @Body() body: BetInput) {
    return this.game.bet(addr(address), body);
  }

  @Post('seeds/rotate')
  rotate(@Param('address') address: string, @Body() body: { clientSeed?: string }) {
    return this.game.rotateSeeds(addr(address), body?.clientSeed);
  }

  @Post('dev/faucet')
  faucet(@Param('address') address: string) {
    if (process.env.NODE_ENV === 'production') throw new ForbiddenException();
    return this.game.devFaucet(addr(address), 1_000n * 10n ** 18n);
  }
}
