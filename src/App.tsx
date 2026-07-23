import { Play, Sparkles } from 'lucide-react';

export default function App() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl p-8 border border-slate-700 shadow-xl text-center space-y-6">
        <div className="mx-auto w-12 h-12 rounded-xl bg-indigo-600/20 text-indigo-400 flex items-center justify-center border border-indigo-500/30">
          <Sparkles className="w-6 h-6 animate-pulse" />
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold tracking-tight">
            Algorithm Visualizer
          </h1>
          <p className="text-slate-400 text-sm">
            Vite + React + Tailwind v4 are successfully configured and ready.
          </p>
        </div>

        <button className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2.5 rounded-lg transition-colors cursor-pointer">
          <Play className="w-4 h-4 fill-current" />
          Get Started
        </button>
      </div>
    </div>
  );
}
