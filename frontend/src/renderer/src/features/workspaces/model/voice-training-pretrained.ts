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
    s2d: `${gptHfRoot}\\s2Dv3.pth`,
  },
  v4: {
    s1: `${gptHfRoot}\\s1v3.ckpt`,
    s2g: `${gptHfRoot}\\gsv-v4-pretrained\\s2Gv4.pth`,
    s2d: `${gptHfRoot}\\gsv-v4-pretrained\\s2Dv4.pth`,
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
