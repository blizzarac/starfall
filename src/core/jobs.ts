import type { Player } from './entities';

export type JobId = 'novice' | 'swordsman';

export interface JobDef {
  id: JobId;
  name: string;
  /** 0 = Novice, 1 = first job, 2 = second job. */
  tier: number;
  maxJobLevel: number;
  hpFactor: number;
  spFactor: number;
  /** Job XP needed per level is multiplied by this. */
  jobXpFactor: number;
  /** Jobs this one can change into. */
  next: JobId[];
  look: { body: number; extra?: 'sword' };
}

export const JOBS: Record<JobId, JobDef> = {
  novice: {
    id: 'novice',
    name: 'Novice',
    tier: 0,
    maxJobLevel: 10,
    hpFactor: 1,
    spFactor: 1,
    jobXpFactor: 1,
    next: ['swordsman'],
    look: { body: 0x4f7bd9 },
  },
  swordsman: {
    id: 'swordsman',
    name: 'Swordsman',
    tier: 1,
    maxJobLevel: 50,
    hpFactor: 1.6,
    spFactor: 1.1,
    jobXpFactor: 2.5,
    next: [],
    look: { body: 0x8a96ad, extra: 'sword' },
  },
};

export const JOB_IDS = new Set<string>(Object.keys(JOBS));

export function isJobId(id: string): id is JobId {
  return JOB_IDS.has(id);
}

export function jobOf(p: Pick<Player, 'jobId'>): JobDef {
  return JOBS[p.jobId];
}

/** The job and every job before it, so earlier skills stay learnable. */
export function jobLineage(jobId: JobId): JobId[] {
  const line: JobId[] = [jobId];
  for (let changed = true; changed; ) {
    changed = false;
    for (const job of Object.values(JOBS)) {
      if (job.next.includes(line[0]!) && !line.includes(job.id)) {
        line.unshift(job.id);
        changed = true;
      }
    }
  }
  return line;
}

/** Requirements to leave the Novice job, as in the design doc. */
export const NOVICE_JOB_CHANGE = { jobLevel: 10, basicTraining: 9 };
