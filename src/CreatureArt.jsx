import React, { useEffect, useState } from "react";

export default function CreatureArt({ speciesId, stage = "normal", emoji = "🐾", className = "" }) {
  const [failedSources, setFailedSources] = useState([]);
  const speciesPath = encodeURIComponent(speciesId || "");
  const stagePath = `${import.meta.env.BASE_URL}assets/creatures/${speciesPath}/${stage}.png`;
  const normalPath = `${import.meta.env.BASE_URL}assets/creatures/${speciesPath}/normal.png`;
  const sources = stage === "normal" ? [stagePath] : [stagePath, normalPath];
  const imageSource = sources.find((source) => !failedSources.includes(source));

  useEffect(() => {
    setFailedSources([]);
  }, [speciesId, stage]);

  if (!speciesId || !imageSource) return emoji;
  return (
    <img
      className={`creature-image${className ? ` ${className}` : ""}`}
      src={imageSource}
      alt=""
      aria-hidden="true"
      onError={() => setFailedSources((failed) => [...failed, imageSource])}
    />
  );
}
