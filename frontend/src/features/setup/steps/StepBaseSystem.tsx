import {
  PROVIDER_BRANDS,
  type ProviderBrandKey,
} from "@/shared/brand/providerBrands";
import { ProviderLogo } from "@/shared/components/ProviderLogo";
import { useSetup } from "../context/SetupContext";

const BASE_OPTIONS: ReadonlyArray<{
  brand: ProviderBrandKey;
  partner: ProviderBrandKey;
  ownLine: string;
}> = [
  { brand: "OMT", partner: "WHISH", ownLine: "I own an OMT system." },
  { brand: "WHISH", partner: "OMT", ownLine: "I own a Whish system." },
];

export default function StepBaseSystem() {
  const { updatePayload, setStep } = useSetup();

  const handleSelect = (base: ProviderBrandKey) => {
    updatePayload({ base_system: base } as never);
    setStep(3);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white">
          Choose Your Base System
        </h2>
        <p className="text-slate-400 text-sm mt-1">
          Which system do you own? The other will require a partner.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {BASE_OPTIONS.map(({ brand, partner, ownLine }) => (
          <button
            key={brand}
            onClick={() => handleSelect(brand)}
            className={`flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-slate-700 ${PROVIDER_BRANDS[brand].hoverBorder} bg-slate-900/60 hover:bg-slate-900 transition-all group`}
          >
            <ProviderLogo
              brand={brand}
              variant="icon"
              size={56}
              className="transition-transform group-hover:scale-105"
            />
            <span className="text-white font-bold text-lg">
              {PROVIDER_BRANDS[brand].name}
            </span>
            <span className="text-slate-400 text-xs text-center">
              {ownLine}
              <br />
              {PROVIDER_BRANDS[partner].name} will require a partner.
            </span>
          </button>
        ))}
      </div>

      <p className="text-xs text-slate-500 text-center">
        This cannot be changed after setup.
      </p>
    </div>
  );
}
