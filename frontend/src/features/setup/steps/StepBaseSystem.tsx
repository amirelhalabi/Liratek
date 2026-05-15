import { useSetup } from "../context/SetupContext";

export default function StepBaseSystem() {
  const { updatePayload, setStep } = useSetup();

  const handleSelect = (base: "OMT" | "WHISH") => {
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
        {/* OMT */}
        <button
          onClick={() => handleSelect("OMT")}
          className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-slate-700 hover:border-[#ffde00] bg-slate-900/60 hover:bg-slate-900 transition-all group"
        >
          <div className="w-14 h-14 rounded-full bg-[#ffde00]/10 flex items-center justify-center group-hover:bg-[#ffde00]/20 transition-colors">
            <span className="text-2xl font-black text-[#ffde00]">O</span>
          </div>
          <span className="text-white font-bold text-lg">OMT</span>
          <span className="text-slate-400 text-xs text-center">
            I own an OMT system.
            <br />
            Whish will require a partner.
          </span>
        </button>

        {/* WHISH */}
        <button
          onClick={() => handleSelect("WHISH")}
          className="flex flex-col items-center gap-3 p-6 rounded-xl border-2 border-slate-700 hover:border-[#ff0a46] bg-slate-900/60 hover:bg-slate-900 transition-all group"
        >
          <div className="w-14 h-14 rounded-full bg-[#ff0a46]/10 flex items-center justify-center group-hover:bg-[#ff0a46]/20 transition-colors">
            <span className="text-2xl font-black text-[#ff0a46]">W</span>
          </div>
          <span className="text-white font-bold text-lg">Whish</span>
          <span className="text-slate-400 text-xs text-center">
            I own a Whish system.
            <br />
            OMT will require a partner.
          </span>
        </button>
      </div>

      <p className="text-xs text-slate-500 text-center">
        This cannot be changed after setup.
      </p>
    </div>
  );
}
