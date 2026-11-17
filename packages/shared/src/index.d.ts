export function hashEmbed(text: string, dim?: number): number[];
export function tokenize(text: string): string[];
export function cosine(a: number[], b: number[]): number;
export function l2normalize(v: number[]): number[];
export function jaccard(a: string[], b: string[]): number;
export function embedText(text: string, opts?: { mode?: string; dim?: number }): Promise<number[]>;
export function embeddingMeta(): { mode: string; hasOpenAIKey: boolean; hasLocalUrl: boolean; jieba: boolean };
export type ScoreBreakdown = {
  hardPass: boolean;
  semantic: number;
  keyword: number;
  discipline: number;
  region: number;
  trlFit: number;
  weights: Record<string, number>;
  embeddingMode?: string;
};
export function scorePair(input: {
  demandText: string;
  demandKeywords: string[];
  demandIndustry: string[];
  demandRegion?: string | null;
  supplyText: string;
  supplyKeywords: string[];
  supplyDisciplines: string[];
  supplyRegion?: string | null;
  trl?: number | null;
  demandEmb?: number[] | null;
  supplyEmb?: number[] | null;
}): { total: number; breakdown: ScoreBreakdown; reason: string };
export function buildOutreachDraft(input: {
  demandTitle: string;
  demandOrg: string;
  supplyTitle: string;
  supplyOrg: string;
  reason: string;
  personName?: string;
  inviteUrl?: string;
}): { subject: string; body: string };
