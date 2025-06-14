import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Play, Download, Upload, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';

// --- Web Audio FM Synthesis Engine ---

let audioContext;
const activeNotes = new Map();

// Helper function to convert MIDI note number to note name
const midiToNoteName = (midi) => {
  if (midi < 0 || midi > 127) return '';
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  return `${noteNames[noteIndex]}${octave}`;
};

// Operator class to manage Oscillator and Envelope Gain
class Operator {
  constructor(context) {
    this.context = context;
    this.osc = context.createOscillator();
    this.env = context.createGain();
    this.env.gain.value = 0;
    this.osc.connect(this.env);
    this.output = this.env; // This is the raw (osc * envelope) output
    this.osc.start();
  }

  connect(destination) {
    this.output.connect(destination);
  }

  scheduleEnvelope(params, time) {
    const { attack, decay, sustain } = params;
    const now = time || this.context.currentTime;
    const gain = this.env.gain;

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    // Envelope now always targets 1.0. The 'level' param will be applied separately.
    gain.linearRampToValueAtTime(1.0, now + attack);
    gain.linearRampToValueAtTime(sustain, now + attack + decay);
  }

  triggerRelease(params) {
    const { release } = params;
    const now = this.context.currentTime;
    const gain = this.env.gain;

    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.linearRampToValueAtTime(0, now + release);

    try {
      this.osc.stop(now + release + 0.5);
    } catch(e) {
      // Already stopped
    }
  }
}

// Main synth class
class FMSynth {
  constructor(context) {
    this.context = context;
    this.masterGain = context.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(context.destination);
    this.patch = null;
  }

  setPatch(patch) {
    this.patch = patch;
  }

  noteOn(note) {
    if (!this.patch || this.context.state === 'suspended') {
      this.context.resume();
    }
    if (activeNotes.has(note)) return;

    const baseFreq = 440 * Math.pow(2, (note - 69) / 12);

    const noteOperators = Array(4).fill(null).map(() => new Operator(this.context));
    const { algorithm, operators: opParams } = this.patch;

    noteOperators.forEach((op, i) => {
      const params = opParams[i];
      if (!params.on) return;

      const freq = baseFreq * params.ratio * (1 + params.detune / 1000);
      op.osc.type = params.waveform;
      op.osc.frequency.setValueAtTime(freq, this.context.currentTime);
      op.scheduleEnvelope(params);
    });

    // --- FIXED ALGORITHM ROUTING ---
    // Helper to connect a modulator to a carrier
    const connectModulator = (modIndex, carIndex) => {
      if (!opParams[modIndex]?.on || !opParams[carIndex]?.on) return;
      const modulator = noteOperators[modIndex];
      const carrier = noteOperators[carIndex];
      const modP = opParams[modIndex];

      const modGain = this.context.createGain();
      // Scale the modulator's output significantly. 'level' now controls modulation depth.
      modGain.gain.value = modP.level * 5000;

      modulator.output.connect(modGain);
      modGain.connect(carrier.osc.frequency);
    };

    // Helper to connect a carrier to the main output
    const connectCarrier = (carIndex) => {
      if (!opParams[carIndex]?.on) return;
      const carrier = noteOperators[carIndex];
      const carP = opParams[carIndex];

      const carGain = this.context.createGain();
      // For carriers, 'level' controls the final volume.
      carGain.gain.value = carP.level;

      carrier.output.connect(carGain);
      carGain.connect(this.masterGain);
    };

    switch (algorithm) {
      case 1: // 1->2->3->4->out
        connectModulator(0, 1);
        connectModulator(1, 2);
        connectModulator(2, 3);
        connectCarrier(3);
        break;
      case 2: // (1->2) + (3->4) -> out
        connectModulator(0, 1);
        connectCarrier(1);
        connectModulator(2, 3);
        connectCarrier(3);
        break;
      case 3: // (1+2)->3 -> 4 -> out
        connectModulator(0, 2);
        connectModulator(1, 2);
        connectModulator(2, 3);
        connectCarrier(3);
        break;
      case 4: // (1+2+3) -> 4 -> out
        connectModulator(0, 3);
        connectModulator(1, 3);
        connectModulator(2, 3);
        connectCarrier(3);
        break;
      case 5: // (1->2) + 3 + 4 -> out
        connectModulator(0, 1);
        connectCarrier(1);
        connectCarrier(2);
        connectCarrier(3);
        break;
      case 6: // 1 + 2 + 3 + 4 -> out (Additive)
      default:
        connectCarrier(0);
        connectCarrier(1);
        connectCarrier(2);
        connectCarrier(3);
        break;
    }

    activeNotes.set(note, noteOperators);
  }

  noteOff(note) {
    const noteOperators = activeNotes.get(note);
    if (!noteOperators) return;

    noteOperators.forEach((op, i) => {
      const params = this.patch.operators[i];
      if (params.on) {
        op.triggerRelease(params);
      }
    });

    activeNotes.delete(note);
  }
}


// --- React Components (No changes below this line) ---

const KEY_TO_NOTE = {
  'a': 60, 'w': 61, 's': 62, 'e': 63, 'd': 64, 'f': 65,
  't': 66, 'g': 67, 'y': 68, 'h': 69, 'u': 70, 'j': 71, 'k': 72,
};

const initialPatch = {
  algorithm: 1,
  masterGain: 0.5,
  operators: [
    { on: true, ratio: 1.00, detune: 0, level: 0.8, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.5, waveform: 'sine' },
    { on: true, ratio: 1.00, detune: 0, level: 0.5, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.5, waveform: 'sine' },
    { on: false, ratio: 5.00, detune: 0, level: 0.4, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.5, waveform: 'sine' },
    { on: true, ratio: 1.00, detune: 0, level: 0.99, attack: 0.01, decay: 0.3, sustain: 0.8, release: 0.5, waveform: 'sine' },
  ]
};

const algorithms = [
  { id: 1, name: '1 > 2 > 3 > 4' },
  { id: 2, name: '(1>2) + (3>4)' },
  { id: 3, name: '(1+2)>3 > 4' },
  { id: 4, name: '(1+2+3) > 4' },
  { id: 5, name: '(1>2) + 3 + 4' },
  { id: 6, name: '1 + 2 + 3 + 4' },
];

const AlgorithmVisualizer = ({ algoId }) => {
  const getStyle = (op) => {
    let carrier = false;
    switch(algoId) {
      case 1: carrier = op === 4; break;
      case 2: carrier = op === 2 || op === 4; break;
      case 3: carrier = op === 4; break;
      case 4: carrier = op === 4; break;
      case 5: carrier = op === 2 || op === 3 || op === 4; break;
      case 6: carrier = true; break;
      default: carrier = true;
    }
    return {
      backgroundColor: carrier ? 'bg-sky-500' : 'bg-pink-500',
      borderColor: carrier ? 'border-sky-300' : 'border-pink-300',
    };
  };

  return (
      <div className="flex space-x-2 p-2 bg-gray-700 rounded-lg">
        {[1, 2, 3, 4].map(op => {
          const { backgroundColor, borderColor } = getStyle(op);
          return (
              <div key={op} className={`w-10 h-10 flex items-center justify-center font-bold text-white rounded ${backgroundColor} border-2 ${borderColor}`}>
                {op}
              </div>
          )
        })}
      </div>
  );
};


const OperatorControls = ({ id, params, updateOperator, isCollapsed, toggleCollapse }) => {
  const { on, ratio, detune, level, attack, decay, sustain, release, waveform } = params;
  const opColor = on ? `border-teal-400` : `border-gray-600`;
  const headerColor = on ? `bg-gray-700` : `bg-gray-800`;

  const handleUpdate = (param, value) => updateOperator(id - 1, { ...params, [param]: value });
  const handleFloatUpdate = (param, value) => handleUpdate(param, parseFloat(value));

  return (
      <div className={`bg-gray-800 rounded-xl border-2 ${opColor} transition-all duration-300`}>
        <div className={`flex items-center justify-between p-3 rounded-t-lg cursor-pointer ${headerColor}`} onClick={toggleCollapse}>
          <div className="flex items-center space-x-3">
            <button onClick={(e) => { e.stopPropagation(); handleUpdate('on', !on); }} className={`w-12 text-sm font-bold py-1 rounded ${on ? 'bg-teal-500 text-white' : 'bg-gray-600 text-gray-400'}`}>
              {on ? 'ON' : 'OFF'}
            </button>
            <h3 className="font-bold text-lg text-white">Operator {id}</h3>
          </div>
          {isCollapsed ? <ChevronDown className="text-gray-400" /> : <ChevronUp className="text-gray-400" />}
        </div>
        {!isCollapsed && (
            <div className={`p-4 grid grid-cols-1 sm:grid-cols-2 gap-4 ${on ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Ratio <span>{ratio.toFixed(2)}</span></label><input type="range" min="0.01" max="16" step="0.01" value={ratio} onChange={(e) => handleFloatUpdate('ratio', e.target.value)} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Detune <span>{detune}</span></label><input type="range" min="-50" max="50" step="1" value={detune} onChange={(e) => handleUpdate('detune', parseInt(e.target.value))} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Level <span>{level.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.01" value={level} onChange={(e) => handleFloatUpdate('level', e.target.value)} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300">Waveform</label><select value={waveform} onChange={(e) => handleUpdate('waveform', e.target.value)} className="w-full bg-gray-700 border border-gray-600 text-white rounded-md p-2"><option value="sine">Sine</option><option value="square">Square</option><option value="sawtooth">Sawtooth</option><option value="triangle">Triangle</option></select></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Attack <span>{attack.toFixed(2)}s</span></label><input type="range" min="0.001" max="2" step="0.001" value={attack} onChange={(e) => handleFloatUpdate('attack', e.target.value)} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Decay <span>{decay.toFixed(2)}s</span></label><input type="range" min="0.01" max="2" step="0.01" value={decay} onChange={(e) => handleFloatUpdate('decay', e.target.value)} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Sustain <span>{sustain.toFixed(2)}</span></label><input type="range" min="0" max="1" step="0.01" value={sustain} onChange={(e) => handleFloatUpdate('sustain', e.target.value)} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
              <div className="space-y-1"><label className="text-sm font-medium text-gray-300 flex justify-between">Release <span>{release.toFixed(2)}s</span></label><input type="range" min="0.01" max="5" step="0.01" value={release} onChange={(e) => handleFloatUpdate('release', e.target.value)} className="w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer" /></div>
            </div>
        )}
      </div>
  );
};

const Keyboard = ({ onNoteOn, onNoteOff, octaveOffset = 0 }) => {
  const [pressedKeys, setPressedKeys] = useState(new Set());

  const keys = [
    { note: 60, key: 'a', type: 'white' }, { note: 61, key: 'w', type: 'black' }, { note: 62, key: 's', type: 'white' },
    { note: 63, key: 'e', type: 'black' }, { note: 64, key: 'd', type: 'white' }, { note: 65, key: 'f', type: 'white' },
    { note: 66, key: 't', type: 'black' }, { note: 67, key: 'g', type: 'white' }, { note: 68, key: 'y', type: 'black' },
    { note: 69, key: 'h', type: 'white' }, { note: 70, key: 'u', type: 'black' }, { note: 71, key: 'j', type: 'white' },
    { note: 72, key: 'k', type: 'white' },
  ];

  const handleInteractionStart = (note) => {
    onNoteOn(note);
    setPressedKeys(prev => new Set(prev).add(note));
  };

  const handleInteractionEnd = (note) => {
    onNoteOff(note);
    setPressedKeys(prev => { const newSet = new Set(prev); newSet.delete(note); return newSet; });
  };

  return (
      <div className="relative h-40 bg-gray-800 p-2 rounded-b-lg select-none">
        {keys.filter(k => k.type === 'white').map((k, index) => (
            <div key={k.note} onMouseDown={() => handleInteractionStart(k.note)} onMouseUp={() => handleInteractionEnd(k.note)} onMouseLeave={() => handleInteractionEnd(k.note)}
                 className={`absolute bottom-2 w-[calc(100%/8-4px)] h-36 border-2 border-gray-500 rounded-md cursor-pointer flex flex-col items-center justify-end pb-2 ${pressedKeys.has(k.note) ? 'bg-sky-400' : 'bg-gray-100'} transition-colors duration-75`}
                 style={{ left: `calc(${index * 100 / 8}% + 2px)`}}>
              <span className="font-bold text-gray-600 text-xs uppercase">{k.key}</span>
              <span className="font-medium text-gray-400 text-[10px] mt-1">{midiToNoteName(k.note + octaveOffset * 12)}</span>
            </div>
        ))}
        {keys.filter(k => k.type === 'black').map((k) => {
          const whiteKeyIndex = keys.filter(wk => wk.type ==='white').findIndex(wk => wk.note > k.note) - 1;
          return (
              <div key={k.note} onMouseDown={() => handleInteractionStart(k.note)} onMouseUp={() => handleInteractionEnd(k.note)} onMouseLeave={() => handleInteractionEnd(k.note)}
                   className={`absolute bottom-12 w-[calc(100%/14)] h-24 border-2 border-gray-700 rounded-md cursor-pointer flex flex-col items-center justify-end pb-2 z-10 ${pressedKeys.has(k.note) ? 'bg-sky-600' : 'bg-gray-900'} transition-colors duration-75 text-white`}
                   style={{ left: `calc(${(whiteKeyIndex + 0.62) * 100 / 8}%)`}}>
                <span className="font-bold text-gray-300 text-xs uppercase">{k.key}</span>
                <span className="font-medium text-gray-500 text-[10px] mt-1">{midiToNoteName(k.note + octaveOffset * 12)}</span>
              </div>
          )
        })}
      </div>
  );
};

export default function App() {
  const [isInitialized, setIsInitialized] = useState(false);
  const synthRef = useRef(null);
  const [patch, setPatch] = useState(initialPatch);
  const [collapsedOps, setCollapsedOps] = useState({ 1: false, 2: false, 3: true, 4: false });
  const [octaveOffset, setOctaveOffset] = useState(0);

  const initAudio = () => {
    if (!isInitialized) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      synthRef.current = new FMSynth(audioContext);
      synthRef.current.setPatch(patch);
      setIsInitialized(true);
    }
  };

  useEffect(() => { if(synthRef.current) { synthRef.current.setPatch(patch); } }, [patch]);

  const handleNoteOn = useCallback((note) => {
    if (!synthRef.current) return;
    const finalNote = note + (octaveOffset * 12);
    if (finalNote >= 0 && finalNote <= 127) {
      synthRef.current.noteOn(finalNote);
    }
  }, [octaveOffset]);

  const handleNoteOff = useCallback((note) => {
    if (!synthRef.current) return;
    const finalNote = note + (octaveOffset * 12);
    if (finalNote >= 0 && finalNote <= 127) {
      synthRef.current.noteOff(finalNote);
    }
  }, [octaveOffset]);

  useEffect(() => {
    const keyMap = new Map();
    const handleKeyDown = (e) => {
      if (e.repeat || keyMap.has(e.key)) return;
      const note = KEY_TO_NOTE[e.key];
      if (note) {
        if(!isInitialized) initAudio();
        handleNoteOn(note);
        keyMap.set(e.key, true);
      }
    };
    const handleKeyUp = (e) => {
      const note = KEY_TO_NOTE[e.key];
      if (note) {
        handleNoteOff(note);
        keyMap.delete(e.key);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isInitialized, handleNoteOn, handleNoteOff]);

  const updateOperator = (opIndex, newParams) => setPatch({ ...patch, operators: patch.operators.map((op, i) => i === opIndex ? newParams : op) });
  const updateAlgorithm = (algoId) => setPatch({ ...patch, algorithm: algoId });
  const toggleOpCollapse = (id) => setCollapsedOps(prev => ({...prev, [id]: !prev[id]}));

  const handleExport = () => {
    const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(patch, null, 2))}`;
    const link = document.createElement('a');
    link.href = jsonString;
    link.download = 'fm-patch.json';
    link.click();
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const importedPatch = JSON.parse(e.target.result);
        if (importedPatch.algorithm && importedPatch.operators && importedPatch.operators.length === 4) {
          setPatch(importedPatch);
        } else { alert('無効なパッチファイル形式です。'); }
      } catch (error) { alert('パッチファイルの読み込み中にエラーが発生しました。'); }
    };
    reader.readAsText(file);
  };

  if (!isInitialized) {
    return (
        <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-4"><div className="text-center bg-gray-800 p-10 rounded-xl shadow-lg"><h1 className="text-4xl font-bold mb-4">4-Op FM Synthesizer</h1><p className="text-gray-400 mb-6">下のボタンをクリックしてオーディオエンジンを開始します。</p><button onClick={initAudio} className="bg-sky-500 hover:bg-sky-600 text-white font-bold py-3 px-6 rounded-lg text-xl flex items-center justify-center space-x-2 transition-all duration-200 transform hover:scale-105"><Play /><span>シンセサイザーを開始</span></button></div></div>
    );
  }

  return (
      <div className="min-h-screen bg-gray-900 text-white p-2 sm:p-4 md:p-6 lg:p-8 font-sans">
        <div className="max-w-7xl mx-auto">
          <header className="flex flex-col md:flex-row justify-between items-center mb-6">
            <h1 className="text-3xl sm:text-4xl font-bold text-sky-400 mb-4 md:mb-0">FM Synthesizer</h1>
            <div className="flex items-center space-x-2 sm:space-x-4">
              <input type="file" id="import-file" className="hidden" onChange={handleImport} accept=".json" />
              <button onClick={() => document.getElementById('import-file').click()} className="bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center space-x-2 transition-transform transform hover:scale-105"><Upload size={20}/> <span>インポート</span></button>
              <button onClick={handleExport} className="bg-teal-500 hover:bg-teal-600 text-white font-semibold py-2 px-4 rounded-lg flex items-center space-x-2 transition-transform transform hover:scale-105"><Download size={20}/> <span>エクスポート</span></button>
            </div>
          </header>

          <main className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 bg-gray-800 p-4 rounded-xl space-y-4">
              <h2 className="text-xl font-bold flex items-center space-x-2"><SlidersHorizontal/><span>グローバル設定</span></h2>
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-300">オペレーターパネル</label>
                <div className="flex space-x-2">
                  <button onClick={() => setCollapsedOps({ 1: false, 2: false, 3: false, 4: false })} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-3 rounded-lg text-sm transition-colors">すべて展開</button>
                  <button onClick={() => setCollapsedOps({ 1: true, 2: true, 3: true, 4: true })} className="w-full bg-gray-700 hover:bg-gray-600 text-white font-semibold py-2 px-3 rounded-lg text-sm transition-colors">すべて折りたたむ</button>
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-gray-300">アルゴリズム</label>
                <div className="mt-2 p-2 bg-gray-900 rounded-lg">
                  <select value={patch.algorithm} onChange={(e) => updateAlgorithm(parseInt(e.target.value))} className="w-full bg-gray-700 border border-gray-600 text-white rounded-md p-2">
                    {algorithms.map(algo => (<option key={algo.id} value={algo.id}>{algo.id}: {algo.name}</option>))}
                  </select>
                  <div className="mt-3 flex justify-center"><AlgorithmVisualizer algoId={patch.algorithm} /></div>
                </div>
              </div>
            </div>

            <div className="lg:col-span-2 space-y-4">
              {[1, 2, 3, 4].map((id) => (
                  <OperatorControls key={id} id={id} params={patch.operators[id-1]} updateOperator={updateOperator} isCollapsed={collapsedOps[id]} toggleCollapse={() => toggleOpCollapse(id)} />
              ))}
            </div>
          </main>

          <footer className="mt-6">
            <div className="bg-gray-800 rounded-lg shadow-lg">
              <div className="p-3 bg-gray-700 rounded-t-lg flex justify-between items-center flex-wrap">
                <div>
                  <h3 className="font-semibold text-lg">仮想キーボード</h3>
                  <p className="text-xs text-gray-400">PCキーボード (A, W, S...) でも演奏できます。</p>
                </div>
                <div className="flex items-center space-x-2 mt-2 sm:mt-0">
                  <span className="font-semibold text-sm">オクターブ: {octaveOffset > 0 ? '+' : ''}{octaveOffset}</span>
                  <button onClick={() => setOctaveOffset(o => Math.max(-2, o - 1))} className="bg-gray-600 hover:bg-gray-500 text-white font-bold w-8 h-8 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={octaveOffset <= -2}>-</button>
                  <button onClick={() => setOctaveOffset(o => Math.min(2, o + 1))} className="bg-gray-600 hover:bg-gray-500 text-white font-bold w-8 h-8 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed" disabled={octaveOffset >= 2}>+</button>
                </div>
              </div>
              <Keyboard onNoteOn={handleNoteOn} onNoteOff={handleNoteOff} octaveOffset={octaveOffset} />
            </div>
          </footer>
        </div>
      </div>
  );
}
