"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface FancyDropdownOption {
  value: string;
  label: string;
  iconPath?: string;
}

const DEFAULT_ICON_PATH =
  "M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm0 3.2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm1.2 8.8H6.8v-1.2h.6V7h-.6V5.8h1.8v5h.6V12Z";

export default function FancyDropdown({
  value,
  options,
  onChange,
  disabled = false,
  className = "",
  ariaLabel,
}: {
  value: string;
  options: FancyDropdownOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState(0);
  const [floatingPosition, setFloatingPosition] = useState({ x: 0, y: 0 });

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((option) => option.value === value)),
    [options, value]
  );
  const selectedOption = options[selectedIndex] || options[0];

  useEffect(() => {
    setHoveredIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current) return;
      if (containerRef.current.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const dropdownOpenHeight = 2.875 * options.length + 2.2;
  const hoveredOption = options[hoveredIndex] || selectedOption;
  const style = {
    "--rotate-arrow": open ? "180deg" : "0deg",
    "--dropdown-height": open ? `${dropdownOpenHeight}rem` : "0rem",
    "--list-opacity": open ? "1" : "0",
    "--translate-value": `${hoveredIndex * 100}%`,
    "--floating-icon-left": `${floatingPosition.x}px`,
    "--floating-icon-top": `${floatingPosition.y}px`,
  } as React.CSSProperties;

  return (
    <div className={`dropdown-container ${className}`.trim()} style={style} ref={containerRef}>
      <button
        type="button"
        className="dropdown-button main-button"
        onClick={() => {
          if (disabled) return;
          setOpen((current) => !current);
        }}
        aria-expanded={open}
        aria-label={ariaLabel || selectedOption?.label || "Dropdown"}
        disabled={disabled}
      >
        <span className="dropdown-title-icon">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <path d={selectedOption?.iconPath || DEFAULT_ICON_PATH} />
          </svg>
        </span>
        <span className="dropdown-title text-truncate">{selectedOption?.label || ""}</span>
        <span className="dropdown-arrow">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <path d="M7.247 11.14 2.451 5.658C1.885 5.013 2.345 4 3.204 4h9.592a1 1 0 0 1 .753 1.659l-4.796 5.48a1 1 0 0 1-1.506 0z" />
          </svg>
        </span>
      </button>

      <div className="dropdown-list-container">
        <div className="dropdown-list-wrapper">
          <ul
            className="dropdown-list"
            ref={listRef}
            onMouseMove={(event) => {
              if (!listRef.current) return;
              const rect = listRef.current.getBoundingClientRect();
              setFloatingPosition({
                x: event.clientX - rect.left - 13,
                y: event.clientY - rect.top - 13,
              });
            }}
          >
            {options.map((option, index) => (
              <li className="dropdown-list-item" key={`${option.value}-${index}`}>
                <button
                  type="button"
                  className="dropdown-button list-button"
                  data-translate-value={`${100 * index}%`}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <span className="text-truncate">{option.label}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="floating-icon" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
              <path d={hoveredOption?.iconPath || DEFAULT_ICON_PATH} />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
