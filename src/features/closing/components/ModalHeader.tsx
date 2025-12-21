/**
 * ModalHeader Component
 * Reusable header for Opening/Closing modals
 */

import { X } from "lucide-react";

interface ModalHeaderProps {
  title: string;
  subtitle: string;
  icon: string;
  gradientFrom: string;
  gradientTo: string;
  onClose: () => void;
}

export function ModalHeader({
  title,
  subtitle,
  icon,
  gradientFrom,
  gradientTo,
  onClose,
}: ModalHeaderProps) {
  return (
    <div
      className={`bg-gradient-to-r from-${gradientFrom} to-${gradientTo} px-6 py-5 flex items-center justify-between`}
    >
      <div>
        <h2 className="text-2xl font-bold text-white">
          {icon} {title}
        </h2>
        <p className={`text-${gradientFrom.split("-")[0]}-100 text-sm mt-1`}>
          {subtitle}
        </p>
      </div>
      <button
        onClick={onClose}
        className="text-white/80 hover:text-white hover:bg-white/10 rounded-lg p-2 transition"
        aria-label="Close modal"
      >
        <X size={24} />
      </button>
    </div>
  );
}
