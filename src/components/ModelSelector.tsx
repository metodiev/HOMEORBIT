"use client";

import { useEffect, useState } from "react";

export function ModelSelector({
  defaultValue,
  name = "model",
  id = "ollama-model",
}: {
  defaultValue?: string | null;
  name?: string;
  id?: string;
}) {
  const [models, setModels] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ollama/models")
      .then((response) => response.json())
      .then((payload: { models?: string[]; error?: string | null }) => {
        if (cancelled) return;
        setModels(payload.models ?? []);
        setError(payload.error ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("Could not reach the Ollama model list.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <label className="label" htmlFor={id}>
        Ollama model
      </label>
      <input
        id={id}
        name={name}
        defaultValue={defaultValue ?? ""}
        list={`${id}-options`}
        placeholder="e.g. llama3.1:8b"
        className="field"
      />
      <datalist id={`${id}-options`}>
        {models.map((model) => (
          <option key={model} value={model} />
        ))}
      </datalist>
      <p className="mt-1 text-[11px] text-ink-soft">
        {models.length > 0
          ? `${models.length} model(s) installed on the Mac Studio. Pick one or type a model name.`
          : error ?? "Model list loads from the local Ollama server."}
      </p>
    </div>
  );
}
