import { BadRequestException, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { parsePublicKey } from '@hashroll/program';
import { config } from '../config.js';
import { HouseService } from './house.service.js';

function wallet(address: string) {
  const key = parsePublicKey(address);
  if (!key) throw new BadRequestException('invalid Solana address');
  return key;
}

const serialize = (v: unknown) => JSON.parse(JSON.stringify(v, (_, x) => (typeof x === 'bigint' ? x.toString() : x)));

/**
 * Bets, balances and history live on-chain; the web app reads them directly from the cluster.
 * The API only does what needs the house key: opening player accounts and committing seeds
 * (the settler loop reveals them), plus the local dev faucet.
 * Opening an account costs the house rent, so phase 2 adds rate limiting here.
 */
@Controller()
export class PlayersController {
  constructor(private readonly house: HouseService) {}

  @Get('house')
  info() {
    return this.house.houseInfo();
  }

  @Post('players/:address/open')
  async open(@Param('address') address: string) {
    return serialize(await this.house.ensurePlayer(wallet(address)));
  }

  @Post('players/:address/dev/faucet')
  faucet(@Param('address') address: string) {
    if (config.isProduction) throw new ForbiddenException();
    return this.house.devFaucet(wallet(address));
  }
}
