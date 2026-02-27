"use client";

import { useEffect, useId, useRef, useState } from "react";

interface MorphingTextProps {
  text: string;
  className?: string;
  morphTime?: number;
}

interface LayerStyle {
  filter: string;
  opacity: string;
}

const INITIAL_LAYER: LayerStyle = {
  filter: "",
  opacity: "100%",
};

const HIDDEN_LAYER: LayerStyle = {
  filter: "",
  opacity: "0%",
};

export default function MorphingText({
  text,
  className = "",
  morphTime = 0.45,
}: MorphingTextProps) {
  const filterId = useId().replace(/:/g, "-");
  const [fromText, setFromText] = useState(text);
  const [toText, setToText] = useState(text);
  const [layerA, setLayerA] = useState<LayerStyle>(HIDDEN_LAYER);
  const [layerB, setLayerB] = useState<LayerStyle>(INITIAL_LAYER);
  const frameRef = useRef<number | null>(null);
  const startRef = useRef<number | null>(null);
  const activeTextRef = useRef(text);
  const previousTextRef = useRef(text);

  useEffect(() => {
    if (text === activeTextRef.current) return;
    previousTextRef.current = activeTextRef.current;
    activeTextRef.current = text;
    setFromText(previousTextRef.current);
    setToText(text);
    setLayerA(INITIAL_LAYER);
    setLayerB(HIDDEN_LAYER);

    startRef.current = null;
    if (frameRef.current) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }

    const animate = (timestamp: number) => {
      if (startRef.current === null) startRef.current = timestamp;
      const elapsed = (timestamp - startRef.current) / 1000;
      const fraction = Math.min(1, elapsed / morphTime);

      const inBlur = Math.min(8 / Math.max(fraction, 0.0001) - 8, 100);
      const outFraction = 1 - fraction;
      const outBlur = Math.min(8 / Math.max(outFraction, 0.0001) - 8, 100);
      setLayerB({
        filter: `blur(${inBlur.toFixed(2)}px)`,
        opacity: `${(Math.pow(fraction, 0.4) * 100).toFixed(2)}%`,
      });
      setLayerA({
        filter: `blur(${outBlur.toFixed(2)}px)`,
        opacity: `${(Math.pow(outFraction, 0.4) * 100).toFixed(2)}%`,
      });

      if (fraction < 1) {
        frameRef.current = window.requestAnimationFrame(animate);
        return;
      }

      setLayerA(HIDDEN_LAYER);
      setLayerB(INITIAL_LAYER);
      frameRef.current = null;
    };

    frameRef.current = window.requestAnimationFrame(animate);
    return () => {
      if (frameRef.current) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    };
  }, [morphTime, text]);

  return (
    <span className={`morph-text ${className}`} style={{ filter: `url(#${filterId}) blur(0.6px)` }}>
      <span className="morph-text-layer" style={layerA}>
        {fromText}
      </span>
      <span className="morph-text-layer" style={layerB}>
        {toText}
      </span>
      <svg className="morph-text-filter" aria-hidden="true">
        <defs>
          <filter id={filterId}>
            <feColorMatrix
              in="SourceGraphic"
              type="matrix"
              values={`1 0 0 0 0
                      0 1 0 0 0
                      0 0 1 0 0
                      0 0 0 255 -140`}
            />
          </filter>
        </defs>
      </svg>
    </span>
  );
}
