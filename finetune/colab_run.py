# ============================================================================
# LEX — Qwen2.5-7B QLoRA fine-tune on Colab FREE tier (T4 16GB)
#
# Steps:
#   1. colab.research.google.com  ->  new notebook (free T4)
#   2. Upload finetune/data/train.json, finetune/data/test.json,
#      finetune/evaluate.py  (left file panel -> Upload files)
#   3. Paste each cell below in order. Total wall time ~30-45 min.
#   4. Download:  lex_refinery_merged/  (for eval) and
#                 lex_refinery.gguf     (for Ollama on the air-gapped box)
#
# If OOM: change max_seq_length 4096 -> 2048 (both places).
# ============================================================================

# --- CELL 1: setup -----------------------------------------------------------
# !pip install -q --upgrade git+https://github.com/unslothai/unsloth.git scikit-learn
# import torch
# from unsloth import FastLanguageModel
# print("torch:", torch.__version__, "| cuda:", torch.cuda.is_available(),
#       "| VRAM:", round(torch.cuda.get_device_properties(0).total_memory / 1e9, 1), "GB")

# --- CELL 2: data (already chat-format: {"messages": [...]}) -----------------
# import pandas as pd
# df = pd.read_json("train.json")
# df = df.sample(frac=1, random_state=42).reset_index(drop=True)
# print("train samples:", len(df))

# --- CELL 3: model + LoRA ----------------------------------------------------
# model, tokenizer = FastLanguageModel.from_pretrained(
#     model_name="unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
#     max_seq_length=4096,
#     load_in_4bit=True,
# )
# model = FastLanguageModel.get_peft_model(
#     model,
#     r=16,
#     target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
#                     "gate_proj", "up_proj", "down_proj"],
#     lora_alpha=32,
#     lora_dropout=0,
#     bias="none",
#     use_gradient_checkpointing="unsloth",
# )

# --- CELL 4: train (~20-35 min on T4) ----------------------------------------
# from trl import SFTTrainer
# from transformers import TrainingArguments
# trainer = SFTTrainer(
#     model=model,
#     tokenizer=tokenizer,
#     train_dataset=df,
#     dataset_text_field=None,          # chat-format "messages" column
#     max_seq_length=4096,
#     dataset_num_proc=4,
#     packing=False,
#     args=TrainingArguments(
#         per_device_train_batch_size=1,
#         gradient_accumulation_steps=4,
#         warmup_steps=50,
#         num_train_epochs=1,
#         learning_rate=2e-4,
#         fp16=not torch.cuda.is_bf16_supported(),
#         bf16=torch.cuda.is_bf16_supported(),
#         logging_steps=20,
#         save_steps=500,
#         weight_decay=0.01,
#         report_to="none",
#     ),
# )
# trainer.train()

# --- CELL 5: save adapter + merged model + GGUF ------------------------------
# model.save_pretrained("lex_refinery_lora")            # small adapter (~25 MB)
# FastLanguageModel.save_pretrained_merged(
#     model, "lex_refinery_merged", tokenizer, save_method="safetensors")
# FastLanguageModel.save_pretrained_gguf(
#     model, "lex_refinery", tokenizer,
#     {"quantization_method": "Q4_K_M"})               # -> lex_refinery-Q4_K_M.gguf (~4.5 GB)

# --- CELL 6: evaluate base vs fine-tuned on held-out test set ----------------
# # Base model (downloads Qwen2.5-7B-Instruct once):
# !python evaluate.py test.json unsloth/Qwen2.5-7B-Instruct
# # Fine-tuned (merged) model:
# !python evaluate.py test.json lex_refinery_merged
# # -> prints accuracy, macro F1, per-class precision/recall/F1 for each

# ============================================================================
# AFTER (on the air-gapped machine, offline):
#   1. Copy lex_refinery-Q4_K_M.gguf onto the box (USB/CD — no network).
#   2. Create a Modelfile:   FROM ./lex_refinery-Q4_K_M.gguf
#   3. ollama create lex-refinery -f Modelfile
#   4. backend/agent/model_registry.py — one-line change:
#        ModelSpec(id="domain_expert", ollama_tag="lex-refinery",
#                  task_types=["sector_trend_classification"])
# ============================================================================
