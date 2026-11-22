import { computeRoll, verifyCommitment } from '@hashroll/fair';
import { GameService } from './game.service.js';
import { PlayerStore } from './player.store.js';

const ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

describe('GameService', () => {
  let game: GameService;
  beforeEach(() => {
    game = new GameService(new PlayerStore());
    game.devFaucet(ADDR, 10n ** 21n);
  });

  it('does not expose the server seed before rotation', () => {
    expect(JSON.stringify(game.publicState(ADDR))).not.toMatch(/serverSeed/);
  });

  it('increments the nonce and keeps the balance consistent', () => {
    const before = BigInt(game.publicState(ADDR).balance);
    const { bet, balance } = game.bet(ADDR, { amount: '1000', target: 5000, direction: 'under' });
    expect(bet.nonce).toBe(0);
    expect(game.publicState(ADDR).nonce).toBe(1);
    expect(BigInt(balance)).toBe(before - 1000n + BigInt(bet.payout));
  });

  it('bets are auditable after revealing the seed', () => {
    const bets = [0, 1, 2].map(() => game.bet(ADDR, { amount: '10', target: 4950, direction: 'over' }).bet);
    const { revealed } = game.rotateSeeds(ADDR, 'new-seed');
    expect(verifyCommitment(revealed.serverSeed, revealed.commitment)).toBe(true);
    for (const b of bets) {
      expect(computeRoll(revealed.serverSeed, b.clientSeed, b.nonce)).toBe(b.roll);
    }
    expect(game.publicState(ADDR).nonce).toBe(0);
  });

  it('rejects insufficient balance and out-of-range target', () => {
    expect(() => game.bet(ADDR, { amount: (10n ** 22n).toString(), target: 5000, direction: 'under' })).toThrow();
    expect(() => game.bet(ADDR, { amount: '1', target: 9900, direction: 'under' })).toThrow();
  });
});
