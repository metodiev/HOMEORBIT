export type WorkflowOperation =
  | "text_to_image"
  | "image_to_image"
  | "inpaint"
  | "background_replace"
  | "remove_object"
  | "restore"
  | "upscale";

export const WORKFLOW_OPERATIONS: { value: WorkflowOperation; label: string; needsImage: boolean; needsMask: boolean }[] = [
  { value: "text_to_image", label: "Text to image", needsImage: false, needsMask: false },
  { value: "image_to_image", label: "Image to image / restyle", needsImage: true, needsMask: false },
  { value: "inpaint", label: "Inpainting", needsImage: true, needsMask: true },
  { value: "background_replace", label: "Background replacement", needsImage: true, needsMask: true },
  { value: "remove_object", label: "Object removal", needsImage: true, needsMask: true },
  { value: "restore", label: "Photo restoration", needsImage: true, needsMask: false },
  { value: "upscale", label: "Upscale", needsImage: true, needsMask: false },
];

export function operationNeedsImage(operation: string): boolean {
  return WORKFLOW_OPERATIONS.find((entry) => entry.value === operation)?.needsImage ?? true;
}

export function operationNeedsMask(operation: string): boolean {
  return WORKFLOW_OPERATIONS.find((entry) => entry.value === operation)?.needsMask ?? false;
}

export type SampleWorkflow = {
  id: string;
  name: string;
  operation: WorkflowOperation;
  modelLabel: string;
  description: string;
  workflow: Record<string, unknown>;
};

const textToImage = {
  "3": {
    class_type: "KSampler",
    inputs: {
      seed: "{{SEED}}",
      steps: "{{STEPS}}",
      cfg: "{{CFG}}",
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
      model: ["4", 0],
      positive: ["6", 0],
      negative: ["7", 0],
      latent_image: ["5", 0],
    },
  },
  "4": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{CHECKPOINT}}" } },
  "5": { class_type: "EmptyLatentImage", inputs: { width: "{{WIDTH}}", height: "{{HEIGHT}}", batch_size: 1 } },
  "6": { class_type: "CLIPTextEncode", inputs: { text: "{{PROMPT}}", clip: ["4", 1] } },
  "7": { class_type: "CLIPTextEncode", inputs: { text: "{{NEGATIVE_PROMPT}}", clip: ["4", 1] } },
  "8": { class_type: "VAEDecode", inputs: { samples: ["3", 0], vae: ["4", 2] } },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "homeorbit", images: ["8", 0] } },
};

const imageToImage = {
  "10": { class_type: "LoadImage", inputs: { image: "{{IMAGE}}" } },
  "11": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{CHECKPOINT}}" } },
  "12": { class_type: "VAEEncode", inputs: { pixels: ["10", 0], vae: ["11", 2] } },
  "13": {
    class_type: "KSampler",
    inputs: {
      seed: "{{SEED}}",
      steps: "{{STEPS}}",
      cfg: "{{CFG}}",
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: "{{DENOISE}}",
      model: ["11", 0],
      positive: ["14", 0],
      negative: ["15", 0],
      latent_image: ["12", 0],
    },
  },
  "14": { class_type: "CLIPTextEncode", inputs: { text: "{{PROMPT}}", clip: ["11", 1] } },
  "15": { class_type: "CLIPTextEncode", inputs: { text: "{{NEGATIVE_PROMPT}}", clip: ["11", 1] } },
  "16": { class_type: "VAEDecode", inputs: { samples: ["13", 0], vae: ["11", 2] } },
  "17": { class_type: "SaveImage", inputs: { filename_prefix: "homeorbit-edit", images: ["16", 0] } },
};

const inpaint = {
  "20": { class_type: "LoadImage", inputs: { image: "{{IMAGE}}" } },
  "21": { class_type: "LoadImageMask", inputs: { image: "{{MASK}}", channel: "red" } },
  "22": { class_type: "CheckpointLoaderSimple", inputs: { ckpt_name: "{{CHECKPOINT}}" } },
  "23": { class_type: "VAEEncodeForInpaint", inputs: { pixels: ["20", 0], vae: ["22", 2], mask: ["21", 0], grow_mask_by: 6 } },
  "24": {
    class_type: "KSampler",
    inputs: {
      seed: "{{SEED}}",
      steps: "{{STEPS}}",
      cfg: "{{CFG}}",
      sampler_name: "dpmpp_2m",
      scheduler: "karras",
      denoise: 1,
      model: ["22", 0],
      positive: ["25", 0],
      negative: ["26", 0],
      latent_image: ["23", 0],
    },
  },
  "25": { class_type: "CLIPTextEncode", inputs: { text: "{{PROMPT}}", clip: ["22", 1] } },
  "26": { class_type: "CLIPTextEncode", inputs: { text: "{{NEGATIVE_PROMPT}}", clip: ["22", 1] } },
  "27": { class_type: "VAEDecode", inputs: { samples: ["24", 0], vae: ["22", 2] } },
  "28": { class_type: "SaveImage", inputs: { filename_prefix: "homeorbit-inpaint", images: ["27", 0] } },
};

const upscale = {
  "30": { class_type: "LoadImage", inputs: { image: "{{IMAGE}}" } },
  "31": { class_type: "ImageScaleBy", inputs: { image: ["30", 0], upscale_method: "lanczos", scale_by: "{{SCALE}}" } },
  "32": { class_type: "SaveImage", inputs: { filename_prefix: "homeorbit-upscale", images: ["31", 0] } },
};

export const SAMPLE_WORKFLOWS: SampleWorkflow[] = [
  {
    id: "sample-text2img",
    name: "ComfyUI · SDXL text to image (sample)",
    operation: "text_to_image",
    modelLabel: "SDXL checkpoint from COMFYUI_CHECKPOINT",
    description:
      "Minimal API-format workflow. Set COMFYUI_CHECKPOINT to an installed checkpoint name, or provide a checkpoint in the generation form.",
    workflow: textToImage,
  },
  {
    id: "sample-img2img",
    name: "ComfyUI · SDXL image to image (sample)",
    operation: "image_to_image",
    modelLabel: "SDXL checkpoint from COMFYUI_CHECKPOINT",
    description: "Restyle or edit an existing image. Denoise controls how far the result may drift from the original.",
    workflow: imageToImage,
  },
  {
    id: "sample-inpaint",
    name: "ComfyUI · Inpainting (sample)",
    operation: "inpaint",
    modelLabel: "SDXL checkpoint from COMFYUI_CHECKPOINT",
    description:
      "Requires a mask image where white marks the area to regenerate. Also usable for background replacement and object removal.",
    workflow: inpaint,
  },
  {
    id: "sample-background",
    name: "ComfyUI · Background replacement (sample)",
    operation: "background_replace",
    modelLabel: "SDXL checkpoint from COMFYUI_CHECKPOINT",
    description:
      "Inpainting template. Mask the background in white and describe the new background in the prompt.",
    workflow: inpaint,
  },
  {
    id: "sample-remove-object",
    name: "ComfyUI · Object removal (sample)",
    operation: "remove_object",
    modelLabel: "SDXL checkpoint from COMFYUI_CHECKPOINT",
    description:
      "Inpainting template. Mask the object in white and describe the clean background you want instead.",
    workflow: inpaint,
  },
  {
    id: "sample-restore",
    name: "ComfyUI · Photo restoration (sample)",
    operation: "restore",
    modelLabel: "SDXL checkpoint from COMFYUI_CHECKPOINT",
    description:
      "Low-denoise image-to-image template. Use a restoration-specific model or workflow for better results with damaged photos.",
    workflow: imageToImage,
  },
  {
    id: "sample-upscale",
    name: "ComfyUI · Upscale 2× (sample)",
    operation: "upscale",
    modelLabel: "Built-in ImageScaleBy node",
    description: "Model-free Lanczos upscale. Replace with an upscale-model workflow if you have one installed.",
    workflow: upscale,
  },
];
