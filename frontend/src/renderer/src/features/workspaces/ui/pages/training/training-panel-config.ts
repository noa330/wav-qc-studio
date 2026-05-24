import type { VoiceTrainingModel } from "@shared/ipc";

export const defaultTrainingModelNames: Record<VoiceTrainingModel, string> = {
  "gpt-sovits": "gpt_sovits_train",
  omnivoice: "omnivoice_train",
};

const generatedTrainingModelNames = new Set([...Object.values(defaultTrainingModelNames), "speaker_unknown_train"].map((name) => name.toLowerCase()));

export function shouldAutoReplaceTrainingModelName(modelName: string): boolean {
  const normalized = modelName.trim().toLowerCase();
  return !normalized || generatedTrainingModelNames.has(normalized);
}
