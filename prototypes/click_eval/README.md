# Click Eval Prototype

Tiny VLM click-point evaluation harness.

## Layout

- `src/click_eval/`: runtime package and CLI
- `tests/`: fixture-based tests with no network calls
- `examples/`: default task/model config files and sample screenshot
- `runs/`: suggested output location

## Input

Create a JSONL task file:

```jsonl
{"task_id":"chat_1","image_path":"screenshots/page.png","instruction":"click the chat button"}
{"task_id":"send_1","image_path":"screenshots/page.png","instruction":"click send","gt_point":[510,742]}
```

`image_path` is resolved relative to the task file. Configured judge model(s)
are called and cached in the run output. If `gt_point` is absent, the harness
uses the coordinate-wise median point from successful judges as the scoring GT.
If `gt_point` is present, that provided point remains the scoring GT and judge
outputs are still recorded for inspection.

The default model config is `examples/models.json`. The abbreviated cloud/API
portion is:

```json
{
  "judge_models": [
    {
      "name": "openai-computer-use-judge",
      "provider": "openai_computer_use",
      "model": "computer-use-preview"
    },
    {
      "name": "claude-opus-4.7-judge",
      "provider": "openrouter",
      "model": "anthropic/claude-opus-4.7"
    },
    {
      "name": "gpt-5.5-judge",
      "provider": "openrouter",
      "model": "openai/gpt-5.5"
    },
    {
      "name": "gemini-3.1-pro-judge",
      "provider": "openrouter",
      "model": "google/gemini-3.1-pro-preview"
    }
  ],
  "candidate_models": [
    {
      "name": "qwen3-vl-8b-instruct",
      "provider": "openrouter",
      "model": "qwen/qwen3-vl-8b-instruct"
    },
    {
      "name": "qwen3-vl-8b-thinking",
      "provider": "openrouter",
      "model": "qwen/qwen3-vl-8b-thinking"
    },
    {
      "name": "ui-tars-1.5-7b",
      "provider": "openrouter",
      "model": "bytedance/ui-tars-1.5-7b"
    },
    {"name": "glm-4.5v", "provider": "openrouter", "model": "z-ai/glm-4.5v"},
    {"name": "glm-4.6v", "provider": "openrouter", "model": "z-ai/glm-4.6v"},
    {
      "name": "glm-5v-turbo",
      "provider": "openrouter",
      "model": "z-ai/glm-5v-turbo"
    },
    {"name": "moondream", "provider": "moondream", "model": "moondream-cloud"},
    {
      "name": "gemini-3.1-pro",
      "provider": "openrouter",
      "model": "google/gemini-3.1-pro-preview"
    }
  ]
}
```

The `name` is only the short label shown in plots and summary files. OpenRouter
is the default provider, but the examples keep it explicit for routability
audits. The default judge IDs were checked against
`https://openrouter.ai/api/v1/models` on 2026-04-27 and are:

- `anthropic/claude-opus-4.7`
- `openai/gpt-5.5`
- `google/gemini-3.1-pro-preview`

The active OpenRouter click-model shortlist was checked against
`https://openrouter.ai/api/v1/models` on 2026-04-26 and includes:

- `qwen/qwen3-vl-8b-instruct`
- `qwen/qwen3-vl-8b-thinking`
- `bytedance/ui-tars-1.5-7b`
- `z-ai/glm-4.5v`
- `z-ai/glm-4.6v`
- `z-ai/glm-5v-turbo`

Shortlist models not found in the current OpenRouter catalog are documented
below as `local_hf` candidates. They are included in `examples/models.json`, but
the provider checks for a CUDA/NVIDIA GPU before importing local inference
dependencies or downloading weights. If no usable CUDA GPU is present, they are
recorded as skipped with the CUDA detection reason.

| Model | Hosting | Setup needed |
| --- | --- | --- |
| `Qwen/Qwen3-VL-2B-Instruct` | Hugging Face | Included as `local_hf`; small generic Qwen3-VL baseline. |
| `Qwen/Qwen3-VL-2B-Thinking` | Hugging Face | Included as `local_hf`; small generic Qwen3-VL thinking baseline. |
| `Qwen/Qwen2.5-VL-3B-Instruct` | Hugging Face | Included as `local_hf`; generic Qwen2.5-VL baseline using a relative point prompt. |
| `mPLUG/GUI-Owl-1.5-2B-Instruct` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI-agent adapter. |
| `mPLUG/GUI-Owl-1.5-4B-Instruct` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI-agent adapter. |
| `mPLUG/GUI-Owl-1.5-8B-Instruct` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI-agent adapter. |
| `vocaela/KV-Ground-8B-BaseGuiOwl1.5-0315` | Hugging Face | Included as `local_hf`; high-performing ScreenSpot-Pro GUI grounder, non-commercial license. |
| `inclusionAI/UI-Venus-1.5-2B` | Hugging Face | Included as `local_hf`; small Qwen3-VL GUI agent. |
| `inclusionAI/UI-Venus-1.5-8B` | Hugging Face | Included as `local_hf`; strong Apache-2.0 GUI agent/grounder. |
| `Hcompany/Holo2-4B` | Hugging Face | Included as `local_hf`; Qwen3-VL computer-use model. |
| `Hcompany/Holo2-8B` | Hugging Face | Included as `local_hf`; Qwen3-VL computer-use model. |
| `Salesforce/GTA1-7B` | Hugging Face | Included as `local_hf`; outputs `pyautogui.click(...)` coordinates after Qwen smart resize. |
| `xlangai/OpenCUA-7B` | Hugging Face | Included as `local_hf`; outputs `pyautogui.click(...)` coordinates after Qwen smart resize. |
| `InfiX-ai/InfiGUI-G1-3B` | Hugging Face | Included as `local_hf`; outputs JSON `point_2d` coordinates after Qwen smart resize. |
| `InfiX-ai/InfiGUI-G1-7B` | Hugging Face | Included as `local_hf`; outputs JSON `point_2d` coordinates after Qwen smart resize. |
| `tencent/POINTS-GUI-G` | Hugging Face | Included as `local_hf`; outputs normalized `(x, y)` coordinates and needs `WePOINTS`. |
| `Tongyi-MAI/MAI-UI-8B` | Hugging Face | Included as `local_hf`; Qwen3-VL GUI agent, may need `HF_TOKEN` depending on access. |
| `allenai/MolmoPoint-GUI-8B` | Hugging Face | Included as `local_hf`; outputs pointing tokens, so model-specific parser tuning may improve results. |
| `microsoft/Fara-7B` | Hugging Face and Microsoft Foundry | Included as `local_hf`; Foundry use would need endpoint credentials and a separate adapter. |
| `ServiceNow/GroundNext-7B-V0` | Hugging Face and Azure AI Foundry | Included as `local_hf`; Azure use would need endpoint credentials and a separate adapter. |
| `osunlp/UGround-V1-2B` | Hugging Face | Included as `local_hf`; smaller UGround model using normalized coordinates. |
| `osunlp/UGround-V1-7B` | Hugging Face | Included as `local_hf`; the model card also documents vLLM OpenAI-compatible serving. |
| `ByteDance-Seed/UI-TARS-2B-SFT` | Hugging Face | Included as `local_hf`; small UI-TARS model using the normalized point adapter. |
| `zonghanHZH/ZonUI-3B` | Hugging Face | Included as `local_hf`; lightweight Qwen2.5-VL GUI grounding model. |
| `Yuqi-Zhou/GUI-G1-3B-v1` | Hugging Face | Included as `local_hf`; 3B GUI grounding model using JSON `point_2d` output. |
| `xlangai/Jedi-3B-1080p` | Hugging Face | Included as `local_hf`; OSWorld-G Qwen2.5-VL click/tool-call model. |
| `xlangai/Jedi-7B-1080p` | Hugging Face | Included as `local_hf`; larger Jedi click/tool-call model. |
| `Tongyi-MiA/UI-Ins-7B` | Hugging Face | Included as `local_hf`; GUI grounding model using tool-call coordinates. |
| `osunlp/GUI-Drag-7B` | Hugging Face | Included as `local_hf`; drag-focused GUI model with preserved click behavior. |
| `OS-Copilot/OS-Atlas-Base-4B` | Hugging Face | Included as `local_hf`; outputs normalized coordinates/boxes, so parser tuning may improve results. |
| `OS-Copilot/OS-Atlas-Base-7B` | Hugging Face | Included as `local_hf`; outputs normalized coordinates/boxes, so parser tuning may improve results. |
| `showlab/ShowUI-2B` | Hugging Face | Included as `local_hf`; parser tuning may be needed for action-dictionary outputs. |
| `Qwen/Qwen3-VL-4B-Instruct` | Hugging Face | Included as `local_hf`; not currently routable through OpenRouter. |
| `Qwen/Qwen3-VL-4B-Thinking` | Hugging Face | Included as `local_hf`; not currently routable through OpenRouter. |

The 2026-04-26 pass also found promising custom-head local models such as
`microsoft/GUI-Actor-3B-Qwen2.5-VL`, `inclusionAI/V2P-7B`, and
`TESS-Computer/qwen-click-dit`. Those are not in the default list yet because
their model cards require custom Python model classes or action heads beyond
plain `transformers` loading.

For HF-local models, install optional local dependencies with:

```bash
uv sync --extra local
```

This installs `torch`, `torchvision`, `transformers`, `accelerate`, `einops`,
`qwen-vl-utils`, `safetensors`, `timm`, `sentencepiece`, `protobuf`,
`requests`, `tiktoken`, and `WePOINTS`. `torch>=2.6` is required for models
that still ship PyTorch `.bin` weights because older PyTorch releases are
blocked by the CVE-2025-32434 `torch.load` guard. MolmoPoint also expects
`einops`, and the Qwen-derived GUI models use `qwen-vl-utils` for image
preprocessing. POINTS-GUI-G requires FlashAttention 2 at runtime, but it is not
installed by the local extra because its native build must match the active
Python, PyTorch, and CUDA environment.

The local provider is intentionally conservative: it only runs when PyTorch can
use CUDA, and it skips non-offloaded models whose estimated VRAM exceeds the
detected GPU memory. Models marked `allow_cpu_offload` use Transformers
`device_map="auto"`; other local models load directly onto `cuda:0`. This
means a misconfigured container where `nvidia-smi` works but `torch.cuda` does
not will be skipped instead of silently running an 8B model on CPU. Local
generation uses the CLI `--timeout` value as the Transformers `max_time` budget.
Several model-specific adapters are included for MolmoPoint, GroundNext,
UGround, OS-Atlas, ShowUI, Qwen3-VL/MAI-UI, OpenCUA, GTA1, InfiGUI, and POINTS-GUI-G.
Local model configs use `fp16` and CPU offload for the larger checkpoints
instead of quantization. MolmoPoint is the
exception: its official inference path uses BF16 autocast, and FP16 overflows in
its pointing-token generation path. Timing for offloaded models will include
CPU-GPU transfer overhead. The local runner unloads each HF model after its
inference and clears the CUDA cache before the next local model. For
gated/private downloads, set `HF_TOKEN`. For Azure/Foundry-hosted variants,
expect an endpoint URL plus API key and a dedicated provider adapter.

Moondream candidates use a provider-qualified entry. OpenAI Computer Use judges
or candidates use `provider: "openai_computer_use"` and require
`OPENAI_API_KEY`. The default Gemini candidate uses OpenRouter, so it only needs
`OPENROUTER_API_KEY`.

```json
{
  "candidate_models": [
    {
      "name": "openai-computer-use-judge",
      "provider": "openai_computer_use",
      "model": "computer-use-preview"
    },
    {
      "name": "moondream",
      "provider": "moondream",
      "model": "moondream-cloud"
    },
    {
      "name": "gemini-3.1-pro",
      "provider": "openrouter",
      "model": "google/gemini-3.1-pro-preview"
    }
  ]
}
```

## Run

```bash
cd prototypes/click_eval
uv sync
export OPENROUTER_API_KEY=...
# Optional, for Moondream candidates:
export MOONDREAM_API_KEY=...
# Optional, for OpenAI Computer Use judges/candidates:
export OPENAI_API_KEY=...
uv run click-eval run
```

Without `uv`, use:

```bash
cd prototypes/click_eval
python -m pip install -r requirements.txt
python -m click_eval run
```

On an interactive terminal, `run` shows tqdm progress bars for tasks and model
calls. In non-interactive output, it prints plain status lines instead. Use
`--no-progress` to suppress both.
Use `--limit N` to run only the first N tasks, and `--model-limit N` to run
only the first N candidate models.

The CLI also loads `OPENAI_API_KEY`, `MOONDREAM_API_KEY`, `GEMINI_API_KEY`,
`GOOGLE_API_KEY`, and `OPENROUTER_API_KEY` from a local `.env` file in
`prototypes/click_eval/` or the current working directory. `GEMINI_API_KEY` is
only needed if you manually add a native `provider: "gemini"` entry.
Moondream calls use `POST https://api.moondream.ai/v1/point` with the screenshot
as a base64 data URL and the click instruction converted to an object query.
OpenRouter Claude calls resize screenshots client-side before upload when the
image exceeds Claude's no-resize long-edge limit, then remap parsed coordinates
from the resized image back to original screenshot pixels. Claude Opus 4.7 uses a
2576 px long-edge target; older Claude models use 1568 px.
OpenAI Computer Use calls use the Responses API with `computer_use_preview`,
request `detail: "original"`, return a `click` action, and remap from a
downscaled display back to original screenshot pixels.
The default Gemini candidate uses OpenRouter's regular multimodal chat API and
the same JSON point prompt as the other OpenRouter VLMs. Native Gemini Computer
Use support remains available for manually configured `provider: "gemini"`
entries.

During a run, the CLI shows progress bars for tasks and per-task candidate model
calls. It also prints compact status lines for GT resolution, provider/model
calls, prediction failures, and the output directory.

OpenRouter candidate calls and OpenRouter GT judges are sent concurrently in
bounded batches of 4. Local HF/GPU candidates stay synchronous and serial to
avoid GPU memory contention; Moondream and Gemini provider calls remain
synchronous.

Outputs:

- `resolved_tasks.jsonl`: task manifest with cached `gt_point`
- `predictions.jsonl`: raw candidate responses and parsed points
- `scores.csv`: per-task L2 distances and threshold hits
- `summary.json`: aggregate metrics per model
- `annotated/*.png`: screenshot overlays with GT, judge points (`GT1`, `GT2`,
  ...), and candidate predictions

`predictions.jsonl`, `scores.csv`, and `summary.json` include per-model
`duration_seconds` timing fields. Skipped local models are marked with
`skipped=true` and an error message explaining the skip reason.

By default, `click-eval run` uses:

- `examples/tasks.jsonl`
- `examples/models.json`
- `runs/<timestamp>`

## Development

```bash
cd prototypes/click_eval
uv run pytest
uv run ruff check .
```
