/**
 * Task Runner — standalone CLI
 *
 * Usage:
 *   npx tsx src/tasks/runner.ts morning-scan
 *   npx tsx src/tasks/runner.ts strategy-eval
 *   npx tsx src/tasks/runner.ts place-orders
 *   npx tsx src/tasks/runner.ts midday-review
 *   npx tsx src/tasks/runner.ts evening-scan
 *   npx tsx src/tasks/runner.ts journal-entry
 *
 * Or via npm scripts:
 *   npm run task:morning
 *   npm run task:strategy
 *   etc.
 */

import dotenv from 'dotenv';
import path from 'path';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import {
  morningScan,
  strategyEval,
  placeOrders,
  middayReview,
  eveningScan,
  endOfDayJournal,
} from '../scheduler';
import { logger } from '../middleware/logger';

const TASK_MAP: Record<string, () => Promise<void>> = {
  'morning-scan': morningScan,
  'strategy-eval': strategyEval,
  'place-orders': placeOrders,
  'midday-review': middayReview,
  'evening-scan': eveningScan,
  'journal-entry': endOfDayJournal,
};

async function main(): Promise<void> {
  const taskName = process.argv[2];

  if (!taskName) {
    console.log('Available tasks:', Object.keys(TASK_MAP).join(', '));
    process.exit(0);
  }

  const task = TASK_MAP[taskName];
  if (!task) {
    console.error(`Unknown task: "${taskName}". Available: ${Object.keys(TASK_MAP).join(', ')}`);
    process.exit(1);
  }

  logger.info(`Running task: ${taskName}`);
  try {
    await task();
    logger.info(`Task completed: ${taskName}`);
    process.exit(0);
  } catch (error) {
    logger.error(`Task failed: ${taskName}`, { error });
    process.exit(1);
  }
}

main();
