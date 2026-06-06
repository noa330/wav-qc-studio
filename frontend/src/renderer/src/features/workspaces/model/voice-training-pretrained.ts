import type { VoiceTrainingSettings } from "@shared/ipc";
import { OMNIVOICE_PRETRAINED, TRAINING_TOOL_ROOT } from "@shared/training-defaults";

export const trainingToolRoot = TRAINING_TOOL_ROOT;

const gptHfRoot = `${trainingToolRoot}\\vendor\\hf\\GPT-SoVITS`;

export const omniPretrainedDefaults = OMNIVOICE_PRETRAINED;

export type GptVersion = VoiceTrainingSettings["gptVersion"];
export type GptPretrainedDefaults = {
  s1: string;
  s2g: string;
  s2d: string;
};

export const gptVersionOptions = [
  { value: "v1", label: "v1" },
  { value: "v2", label: "v2" },
  { value: "v3", label: "v3" },
  { value: "v4", label: "v4" },
  { value: "v2Pro", label: "v2Pro" },
  { value: "v2ProPlus", label: "v2ProPlus" },
] as const satisfies ReadonlyArray<{ value: GptVersion; label: string }>;

export const gptPretrainedDefaults: Record<GptVersion, GptPretrainedDefaults> = {
  v1: {
    s1: `${gptHfRoot}\\s1bert25hz-2kh-longer-epoch=68e-step=50232.ckpt`,
    s2g: `${gptHfRoot}\\s2G488k.pth`,
    s2d: `${gptHfRoot}\\s2D488k.pth`,
  },
  v2: {
    s1: `${gptHfRoot}\\gsv-v2final-pretrained\\s1bert25hz-5kh-longer-epoch=12-step=369668.ckpt`,
    s2g: `${gptHfRoot}\\gsv-v2final-pretrained\\s2G2333k.pth`,
    s2d: `${gptHfRoot}\\gsv-v2final-pretrained\\s2D2333k.pth`,
  },
  v3: {
    s1: `${gptHfRoot}\\s1v3.ckpt`,
    s2g: `${gptHfRoot}\\s2Gv3.pth`,
    s2d: "",
  },
  v4: {
    s1: `${gptHfRoot}\\s1v3.ckpt`,
    s2g: `${gptHfRoot}\\gsv-v4-pretrained\\s2Gv4.pth`,
    s2d: "",
  },
  v2Pro: {
    s1: `${gptHfRoot}\\s1v3.ckpt`,
    s2g: `${gptHfRoot}\\v2Pro\\s2Gv2Pro.pth`,
    s2d: `${gptHfRoot}\\v2Pro\\s2Dv2Pro.pth`,
  },
  v2ProPlus: {
    s1: `${gptHfRoot}\\s1v3.ckpt`,
    s2g: `${gptHfRoot}\\v2Pro\\s2Gv2ProPlus.pth`,
    s2d: `${gptHfRoot}\\v2Pro\\s2Dv2ProPlus.pth`,
  },
};

const gptStageDefaults = { epochs: 15, saveEveryEpoch: 5 };
const gptSovitsDefaultsByVersion: Record<GptVersion, { epochs: number; saveEveryEpoch: number }> = {
  v1: { epochs: 8, saveEveryEpoch: 4 },
  v2: { epochs: 8, saveEveryEpoch: 4 },
  v3: { epochs: 2, saveEveryEpoch: 1 },
  v4: { epochs: 2, saveEveryEpoch: 1 },
  v2Pro: { epochs: 8, saveEveryEpoch: 4 },
  v2ProPlus: { epochs: 8, saveEveryEpoch: 4 },
};

export function usesGptSovitsLora(version: GptVersion): boolean {
  return version === "v3" || version === "v4";
}

export function trainingSettingsWithGptVersion(current: VoiceTrainingSettings, gptVersion: GptVersion): VoiceTrainingSettings {
  const previousDefaults = gptPretrainedDefaults[current.gptVersion];
  const nextDefaults = gptPretrainedDefaults[gptVersion];
  const previousTrainDefaults = gptSovitsDefaultsByVersion[current.gptVersion];
  const nextTrainDefaults = gptSovitsDefaultsByVersion[gptVersion];
  return {
    ...current,
    gptVersion,
    gptSovitsEpochs: current.gptSovitsEpochs === previousTrainDefaults.epochs ? nextTrainDefaults.epochs : current.gptSovitsEpochs,
    gptSovitsSaveEveryEpoch: current.gptSovitsSaveEveryEpoch === previousTrainDefaults.saveEveryEpoch ? nextTrainDefaults.saveEveryEpoch : current.gptSovitsSaveEveryEpoch,
    gptEpochs: current.gptEpochs || gptStageDefaults.epochs,
    gptSaveEveryEpoch: current.gptSaveEveryEpoch || gptStageDefaults.saveEveryEpoch,
    gptPretrainedS2G: shouldReplaceGptPretrainedPath(current.gptPretrainedS2G, previousDefaults.s2g, "s2g") ? nextDefaults.s2g : current.gptPretrainedS2G,
    gptPretrainedS2D: shouldReplaceGptPretrainedPath(current.gptPretrainedS2D, previousDefaults.s2d, "s2d") ? nextDefaults.s2d : current.gptPretrainedS2D,
    gptPretrainedS1: shouldReplaceGptPretrainedPath(current.gptPretrainedS1, previousDefaults.s1, "s1") ? nextDefaults.s1 : current.gptPretrainedS1,
  };
}

export function isDefaultGptPretrainedPath(value: string, key: keyof GptPretrainedDefaults): boolean {
  const normalized = normalizePath(value);
  return Object.values(gptPretrainedDefaults).some((defaults) => {
    const defaultPath = normalizePath(defaults[key]);
    return normalized === defaultPath
      || normalized.endsWith(`\\${defaultPath}`);
  });
}

export function shouldReplaceGptPretrainedPath(value: string, previousDefault: string, key: keyof GptPretrainedDefaults): boolean {
  const normalized = normalizePath(value);
  return normalized.length === 0 || normalized === normalizePath(previousDefault) || isDefaultGptPretrainedPath(value, key);
}

function normalizePath(value: string): string {
  return value.trim().replace(/\//gu, "\\").toLowerCase();
}
