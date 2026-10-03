import type { Player } from './entities';

export type JobId = 'novice' | 'swordsman' | 'mage' | 'archer' | 'acolyte' | 'knight' | 'wizard' | 'hunter' | 'priest';

/** What a job's chibi holds. */
export type JobExtra = 'sword' | 'staff' | 'bow' | 'mace';

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
  look: { body: number; extra?: JobExtra };
  /** Given (and equipped) on joining, so the job's skills work from the first minute. */
  starterWeapon?: string;
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
    next: ['swordsman', 'mage', 'archer', 'acolyte'],
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
    next: ['knight'],
    look: { body: 0x8a96ad, extra: 'sword' },
    starterWeapon: 'short_sword',
  },
  mage: {
    id: 'mage',
    name: 'Mage',
    tier: 1,
    maxJobLevel: 50,
    hpFactor: 0.9,
    spFactor: 2.2,
    jobXpFactor: 2.5,
    next: ['wizard'],
    look: { body: 0x6a4fa0, extra: 'staff' },
    starterWeapon: 'oak_staff',
  },
  archer: {
    id: 'archer',
    name: 'Archer',
    tier: 1,
    maxJobLevel: 50,
    hpFactor: 1.15,
    spFactor: 1.4,
    jobXpFactor: 2.5,
    next: ['hunter'],
    look: { body: 0x4f9a5a, extra: 'bow' },
    starterWeapon: 'willow_bow',
  },
  acolyte: {
    id: 'acolyte',
    name: 'Acolyte',
    tier: 1,
    maxJobLevel: 50,
    hpFactor: 1.25,
    spFactor: 1.8,
    jobXpFactor: 2.5,
    next: ['priest'],
    look: { body: 0xf0e6cc, extra: 'mace' },
    starterWeapon: 'wooden_mace',
  },
  knight: {
    id: 'knight',
    name: 'Knight',
    tier: 2,
    maxJobLevel: 50,
    hpFactor: 2.2,
    spFactor: 1.3,
    jobXpFactor: 4,
    next: [],
    look: { body: 0x3f6fd6, extra: 'sword' },
  },
  wizard: {
    id: 'wizard',
    name: 'Wizard',
    tier: 2,
    maxJobLevel: 50,
    hpFactor: 1.1,
    spFactor: 2.8,
    jobXpFactor: 4,
    next: [],
    look: { body: 0x3b2a78, extra: 'staff' },
  },
  hunter: {
    id: 'hunter',
    name: 'Hunter',
    tier: 2,
    maxJobLevel: 50,
    hpFactor: 1.5,
    spFactor: 1.7,
    jobXpFactor: 4,
    next: [],
    look: { body: 0x2f6b4a, extra: 'bow' },
  },
  priest: {
    id: 'priest',
    name: 'Priest',
    tier: 2,
    maxJobLevel: 50,
    hpFactor: 1.6,
    spFactor: 2.4,
    jobXpFactor: 4,
    next: [],
    look: { body: 0x5a3f8f, extra: 'mace' },
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

/** First jobs move on to their second job at this job level. */
export const SECOND_JOB_LEVEL = 25;
