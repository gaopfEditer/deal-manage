# Ollama 看图失败排查（Qwen2.5-VL）

## 现象

模型回复「无法分析图片」「img-0 为空」等，但明明装的是 VL 模型。

## 根因（你当前环境）

执行 `ollama show qwen2.5-vl-7b`，若 **Capabilities 只有 `completion`、没有 `vision`**，说明 Ollama 里注册的是**不完整**的 VL：

- 仅有 `Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf`（语言权重）
- **缺少** `mmproj` 视觉投影 GGUF（例如 `Qwen2.5-VL-7B-Instruct-mmproj-f16.gguf`）

没有 mmproj 时，接口仍会收到图片占位符，模型却**看不见像素**，只能瞎编「无法看图」。

## 方案 A（推荐）：官方模型

```powershell
ollama pull qwen2.5vl:7b
$env:OLLAMA_MODEL = "qwen2.5vl:7b"
cd D:\frontend\main\1.operations\deal-manage\tmp
python ollama_demo.py
```

确认：`ollama show qwen2.5vl:7b` 应包含 **vision**。

## 方案 B：继续用本地 GGUF

1. 下载 mmproj（与主模型放同一目录 `D:\frontend\tmp\qwen\`）  
   https://huggingface.co/Mungert/Qwen2.5-VL-7B-Instruct-GGUF/resolve/main/Qwen2.5-VL-7B-Instruct-mmproj-f16.gguf

2. 使用已修正的 `Modelfile`（含两行 `FROM` + 正确 ``）

3. 重建模型：

```powershell
ollama rm qwen2.5-vl-7b
cd D:\frontend\tmp\qwen
ollama create qwen2.5-vl-7b -f Modelfile
ollama show qwen2.5-vl-7b
```

Capabilities 出现 **vision** 后再跑 `ollama_demo.py`：

```powershell
$env:OLLAMA_MODEL = "qwen2.5-vl-7b"
```

## Modelfile 模板错误

若模板里写成 `` 以外的错误 token，多轮/多模态也会异常。已改为 Qwen 标准的 ``。
