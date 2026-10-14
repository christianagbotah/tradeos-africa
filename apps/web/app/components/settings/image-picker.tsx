"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "../ui/button";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const COPY = {
  photo: { choose: "Choose photo", replace: "Replace photo", remove: "Remove photo", alt: "Profile photo preview" },
  logo: { choose: "Choose logo", replace: "Replace logo", remove: "Remove logo", alt: "Business logo preview" },
} as const;

export function ImagePicker({
  kind,
  currentUrl,
  selectedFile = null,
  busy = false,
  disabled = false,
  onChoose,
  onRemove,
}: {
  kind: keyof typeof COPY;
  currentUrl: string | null | undefined;
  selectedFile?: File | null;
  busy?: boolean;
  disabled?: boolean;
  onChoose: (file: File) => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const generatedId = useId();
  const inputId = `settings-image-${generatedId.replace(/:/g, "")}`;
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[kind];

  useEffect(() => {
    if (!selectedFile) {
      setPreviewUrl(null);
      return;
    }
    const objectUrl = URL.createObjectURL(selectedFile);
    setPreviewUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [selectedFile]);

  const visibleUrl = previewUrl ?? currentUrl ?? null;
  const hasImage = Boolean(visibleUrl || selectedFile);

  const choose = async (file: File | undefined) => {
    if (!file || disabled || busy) return;
    setError(null);
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError("Choose a JPEG, PNG or WebP image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setError("Image must be 5 MiB or smaller.");
      return;
    }
    await onChoose(file);
  };

  return (
    <div className="tos-image-picker" data-kind={kind}>
      <div className={`tos-image-picker__preview tos-image-picker__preview--${kind}`}>
        {visibleUrl ? <img src={visibleUrl} alt={copy.alt} /> : <span aria-hidden="true">{kind === "photo" ? "U" : "B"}</span>}
      </div>
      <div className="tos-image-picker__controls">
        <input
          id={inputId}
          className="tos-image-picker__input"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            void choose(file);
          }}
        />
        <label className="tos-image-picker__choose" htmlFor={inputId} aria-disabled={disabled || busy}>
          {busy ? "Uploading…" : hasImage ? copy.replace : copy.choose}
        </label>
        {hasImage ? <Button type="button" size="sm" variant="ghost" disabled={disabled || busy} onClick={() => void onRemove()}>{copy.remove}</Button> : null}
        <small>JPEG, PNG or WebP · max 5 MiB</small>
        {error ? <span className="tos-image-picker__error" role="alert">{error}</span> : null}
      </div>
    </div>
  );
}
