
import React, { useState, useEffect, useRef, useCallback, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Target, Zap, Play, RotateCcw, Home, HelpCircle, Trophy, AlertTriangle, BookOpen, ChevronRight, ChevronLeft, X, ListOrdered, Save, User, Pause, PlayCircle, ArrowRight, CheckCircle2, AlertCircle, Sparkles, MousePointer2, Flame, Skull, Snowflake, RefreshCw, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ScoreService, ScoreRecord } from './src/services/scoreService';

// --- Constants & Types ---

type GameMode = 'multiples' | 'divisors' | 'adventure';
type GameState = 'menu' | 'playing' | 'gameover' | 'victory' | 'tutorial' | 'leaderboard' | 'flowchart';

interface Point {
  x: number;
  y: number;
}

interface Ball {
  id: number;
  value: number;
  pos: number; // 0 to 1 along the path
  color: string;
  angle: number; // Rotation angle
  isBonus?: boolean; // New property for bonus balls
}

interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number; 
  trail: Point[]; 
  button: number; // 0 for left, 2 for right
}

interface Effect {
  type: 'particle' | 'text' | 'combo' | 'ui';
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  life: number;
  maxLife: number;
  text?: string;
  color: string;
  size?: number;
}

const COLORS = ['#f43f5e', '#06b6d4', '#8b5cf6', '#10b981', '#f59e0b'];
const BONUS_COLOR = '#d946ef'; // Fuchsia/Purple for bonus
const BALL_RADIUS = 20;
const BALL_DIAMETER = BALL_RADIUS * 2;
const PROJECTILE_SPEED = 22; 
const PATH_SAMPLES = 1500; 
const INITIAL_SPEED = 0.00022; 
const SPEED_INCREMENT = 0.00003;
const CATCHUP_SPEED_MULTIPLIER = 4; 
const MAX_SPEED = 0.0012; 
const ENERGY_GAIN = 15; 
const ENERGY_LOSS = 30; 
const BONUS_COOLDOWN = 12000; // 12 seconds cooldown between bonus balls

// --- Utility Functions ---

const getRandomInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;

const getConditionMatch = (val: number, target: number, mode: GameMode): boolean => {
  if (mode === 'multiples') return val % target === 0;
  return val !== 0 && target % val === 0;
};

const generatePath = (width: number, height: number): { points: Point[], totalLength: number } => {
  const points: Point[] = [];
  const centerX = width / 2;
  const centerY = height / 2;
  const maxRadius = Math.min(width, height) * 0.44;
  const loops = 3.5; 
  let totalLength = 0;

  let prevX = 0;
  let prevY = 0;

  for (let i = 0; i <= PATH_SAMPLES; i++) {
    const t = i / PATH_SAMPLES;
    const angle = t * Math.PI * 2 * loops;
    const radius = maxRadius * (1 - t * 0.9); 
    const x = centerX + Math.cos(angle) * radius;
    const y = centerY + Math.sin(angle) * radius;
    
    points.push({ x, y });

    if (i > 0) {
      const dist = Math.sqrt((x - prevX)**2 + (y - prevY)**2);
      totalLength += dist;
    }
    prevX = x;
    prevY = y;
  }
  return { points, totalLength };
};

// --- Main Component ---

const ZumaMathGame = () => {
  const [gameState, setGameState] = useState<GameState>('menu');
  const [isPaused, setIsPaused] = useState(false);
  const [gameMode, setGameMode] = useState<GameMode>('multiples');
  const [targetNumber, setTargetNumber] = useState<number>(5);
  const [customTarget, setCustomTarget] = useState<string>('');
  const [score, setScore] = useState<number>(0);
  const [energy, setEnergy] = useState<number>(100); 
  const [level, setLevel] = useState<number>(1);
  const [leaderboard, setLeaderboard] = useState<ScoreRecord[]>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | 'adventure'>('all');
  const [loadingScores, setLoadingScores] = useState<boolean>(false);
  const [playerName, setPlayerName] = useState<string>('');
  const [scoreSaved, setScoreSaved] = useState<boolean>(false);
  const [isAdventure, setIsAdventure] = useState<boolean>(false);
  const [activeTip, setActiveTip] = useState<string | null>(null);
  const [comboMessage, setComboMessage] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [tutorialStep, setTutorialStep] = useState<number>(0);
  const [comboDisplay, setComboDisplay] = useState<number>(0);
  const [isFrozen, setIsFrozen] = useState<boolean>(false); // UI State for freeze
  const [firebaseStatus, setFirebaseStatus] = useState<'testing' | 'connected' | 'disconnected'>('testing');
  
  // Zuma Mechanics
  const [progress, setProgress] = useState<number>(0);
  const [quota, setQuota] = useState<number>(10); 

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<number>(0);
  
  const pathRef = useRef<{ points: Point[], totalLength: number }>({ points: [], totalLength: 0 });
  const ballsRef = useRef<Ball[]>([]);
  const projectilesRef = useRef<Projectile[]>([]);
  const effectsRef = useRef<Effect[]>([]);
  
  const shooterAngleRef = useRef<number>(0);
  const lastShootTimeRef = useRef<number>(0);
  const SHOOT_COOLDOWN = 150; // ms
  
  const gameSpeedRef = useRef<number>(INITIAL_SPEED);
  const speedPenaltyMultiplierRef = useRef<number>(1);
  const freezeEndTimeRef = useRef<number>(0); // Timestamp when freeze ends
  const lastBonusSpawnTimeRef = useRef<number>(0); // Track last bonus spawn
  
  // PERFORMANCE FIX: Ref to track frozen state without triggering re-renders inside the loop
  const isFrozenRef = useRef<boolean>(false);
  const path2DRef = useRef<Path2D | null>(null);

  const ballCounterRef = useRef<number>(0);
  const screenShakeRef = useRef<number>(0);
  const comboRef = useRef<number>(0);
  const comboTimerRef = useRef<any>(null);

  const resetCombo = () => {
    if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
    comboRef.current = 0;
    setComboDisplay(0);
  };

  const updateCombo = (points: number) => {
    const newCombo = comboRef.current;
    if (newCombo > 0 && newCombo % 5 === 0) {
      const msgs = ["¡Increíble!", "¡Genio!", "¡Imparable!", "¡Dominando!", "¡Matemático!", "¡Perfecto!"];
      setComboMessage(msgs[Math.min(msgs.length - 1, Math.floor(newCombo / 5) - 1)]);
      setTimeout(() => setComboMessage(null), 1500);
    }
    const multiplier = 1 + Math.floor(newCombo / 5) * 0.1;
    setScore(s => s + Math.round(points * multiplier));
  };
  
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width === 0 || height === 0) continue;
        setDimensions({ width, height });
        const pathData = generatePath(width, height);
        pathRef.current = pathData;
        
        // Create Path2D for optimized drawing
        const p2d = new Path2D();
        pathData.points.forEach((p, i) => {
          if (i === 0) p2d.moveTo(p.x, p.y);
          else p2d.lineTo(p.x, p.y);
        });
        path2DRef.current = p2d;
      }
    });
    observer.observe(containerRef.current);
    
    const { clientWidth, clientHeight } = containerRef.current;
    setDimensions({ width: clientWidth, height: clientHeight });
    pathRef.current = generatePath(clientWidth, clientHeight);

    return () => observer.disconnect();
  }, []);

  const spawnParticles = (x: number, y: number, color: string, count = 10) => {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = Math.random() * 6 + 2;
      effectsRef.current.push({
        type: 'particle', x, y,
        vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
        life: 1, maxLife: 1, color, size: Math.random() * 4 + 2,
      });
    }
  };

  const spawnText = (x: number, y: number, text: string, color: string, size = 20, type: 'text' | 'combo' | 'ui' = 'text') => {
    effectsRef.current.push({
      type, x, y, vy: type === 'ui' ? 0 : -1.8,
      life: 1, maxLife: 1, text, color, size,
    });
  };

  const generateFairValue = (target: number, mode: GameMode, lvl: number, force?: 'match' | 'no-match'): number => {
    // Dynamic spawn rate: More targets in early levels
    const baseProb = 0.5;
    const earlyLevelBonus = Math.max(0, 0.3 - (lvl - 1) * 0.1);
    const matchProb = baseProb + earlyLevelBonus;

    const shouldMatch = force === 'match' ? true : (force === 'no-match' ? false : Math.random() < matchProb);
    
    if (mode === 'multiples') {
      if (shouldMatch) return target * getRandomInt(1, 10);
      let val = getRandomInt(1, 50);
      for (let i = 0; i < 5 && val % target === 0; i++) val = getRandomInt(1, 50);
      return val;
    } else {
      const divisors = [];
      for (let i = 1; i <= target; i++) if (target % i === 0) divisors.push(i);
      if (shouldMatch && divisors.length > 0) return divisors[getRandomInt(0, divisors.length - 1)];
      let val = getRandomInt(1, target + 10);
      for (let i = 0; i < 5 && (val !== 0 && target % val === 0); i++) val = getRandomInt(1, target + 10);
      return val;
    }
  };

  const initLevel = (lvl: number, mode: GameMode, chosenTarget?: number, resetScore = true) => {
    let target = chosenTarget || targetNumber;
    if (!chosenTarget) {
      if (mode === 'multiples') {
        // More controlled growth for multiples
        target = getRandomInt(2, Math.min(12, 3 + lvl));
      } else {
        // Easier numbers for divisors at early levels
        const easyDivisors = [6, 8, 10, 12, 14, 15, 16, 18, 20, 24];
        const midDivisors = [30, 36, 40, 42, 45, 48, 50, 54, 60];
        const hardDivisors = [72, 80, 84, 90, 100, 120];
        
        let pool = easyDivisors;
        if (lvl > 8) pool = hardDivisors;
        else if (lvl > 4) pool = midDivisors;
        
        target = pool[getRandomInt(0, pool.length - 1)];
      }
    }
    setTargetNumber(target);
    if (resetScore) setScore(0);
    setEnergy(100);
    setLevel(lvl);
    setScoreSaved(false);
    setIsPaused(false);
    
    // Lower quota for early levels
    const ballsNeeded = Math.min(40, 8 + lvl * 4); 
    setQuota(ballsNeeded);
    setProgress(0);
    
    gameSpeedRef.current = Math.min(MAX_SPEED, INITIAL_SPEED + (lvl - 1) * SPEED_INCREMENT);
    speedPenaltyMultiplierRef.current = 1;
    freezeEndTimeRef.current = 0;
    lastBonusSpawnTimeRef.current = 0; 
    setIsFrozen(false);
    isFrozenRef.current = false;
    
    projectilesRef.current = [];
    effectsRef.current = [];
    ballsRef.current = [];
    comboRef.current = 0;
    setComboDisplay(0);
    
    ballCounterRef.current = 0;
  };

  const onMove = (e: any) => {
    if (isPaused || gameState !== 'playing') return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = (e.clientX || e.touches?.[0]?.clientX) - rect.left;
    const y = (e.clientY || e.touches?.[0]?.clientY) - rect.top;
    shooterAngleRef.current = Math.atan2(y - dimensions.height / 2, x - dimensions.width / 2);
  };

  const onShoot = (e: any) => {
    if (gameState !== 'playing' || isPaused) return;

    // Prevent double triggering from touch + mouse
    if (e.type === 'touchstart') {
        e.preventDefault();
    }
    
    const now = Date.now();
    if (now - lastShootTimeRef.current < SHOOT_COOLDOWN) return;
    lastShootTimeRef.current = now;
    
    // Support both mouse and touch
    // For touch, we'll treat it as left click (button 0)
    let button = 0;
    if (e.button !== undefined) {
        button = e.button;
    }
    
    const angle = shooterAngleRef.current;
    projectilesRef.current.push({
      x: dimensions.width / 2 + Math.cos(angle) * 45,
      y: dimensions.height / 2 + Math.sin(angle) * 45,
      vx: Math.cos(angle) * PROJECTILE_SPEED,
      vy: Math.sin(angle) * PROJECTILE_SPEED,
      value: targetNumber, 
      trail: [], 
      button: button,
    });
  };

  const handleHit = (hitBall: Ball, projectile: Projectile, ballIndex: number) => {
    const isMatch = getConditionMatch(hitBall.value, targetNumber, gameMode);
    const isLeftClick = projectile.button === 0;
    const isRightClick = projectile.button === 2;
    
    // Success if:
    // 1. It's a match and we used left click
    // 2. It's NOT a match and we used right click
    const success = (isMatch && isLeftClick) || (!isMatch && isRightClick);
    
    const pIdx = Math.max(0, Math.min(PATH_SAMPLES - 1, Math.floor(hitBall.pos * (PATH_SAMPLES - 1))));
    const p = pathRef.current.points[pIdx];

    if (success) {
      // --- GOOD HIT ---
      comboRef.current += 1;
      setComboDisplay(comboRef.current);
      if (comboTimerRef.current) clearTimeout(comboTimerRef.current);
      comboTimerRef.current = setTimeout(() => {
        comboRef.current = 0;
        setComboDisplay(0);
      }, 4000);

      const comboCount = comboRef.current;
      const basePoints = 100 + comboCount * 20;
      updateCombo(basePoints);

      // Threshold Bonuses
      if (comboCount >= 10) {
        if(p) spawnText(p.x, p.y - 110, "LEGENDARY COMBO!", "#f59e0b", 36, 'combo');
      } else if (comboCount >= 5) {
        if(p) spawnText(p.x, p.y - 110, "SUPER COMBO!", "#fbbf24", 32, 'combo');
      }

      // Bonus Ball Logic
      if (hitBall.isBonus) {
        setScore(s => s + 500); // Direct extra score for bonus
        freezeEndTimeRef.current = Date.now() + 5000; // Freeze for 5 seconds
        if(p) {
            spawnText(p.x, p.y - 60, "¡CONGELADO!", "#38bdf8", 28, 'text');
            spawnText(p.x, p.y - 85, "+500", "#d946ef", 32, 'text');
        }
      }

      const energyGain = Math.max(10, 20 - level);
      setEnergy(e => Math.min(100, e + energyGain));
      setProgress(prog => Math.min(quota, prog + 1)); 
      
      const b = ballsRef.current[ballIndex];
      if (b && p) spawnParticles(p.x, p.y, b.isBonus ? BONUS_COLOR : '#f59e0b', 15);

      const comboText = comboCount > 1 ? `COMBO x${comboCount}!` : `+${basePoints}`;
      if (p && !hitBall.isBonus) {
        let comboColor = '#fff';
        if (comboCount >= 10) comboColor = '#d946ef'; // Legendary
        else if (comboCount >= 5) comboColor = '#f59e0b'; // Super
        else if (comboCount > 1) comboColor = '#fbbf24'; // Regular combo
        
        spawnText(p.x, p.y - 30, comboText, comboColor, comboCount > 1 ? 32 : 24, comboCount > 1 ? 'combo' : 'text');
        if (comboCount > 1) spawnParticles(p.x, p.y, comboColor, 20);
      }
      
      screenShakeRef.current = comboCount > 1 ? 3 + Math.min(5, comboCount) : 2;
      
    } else {
      // --- BAD HIT (Wrong condition or wrong button) ---
      resetCombo();
      
      // Calculate a helpful tip
      if (hitBall && activeTip === null) {
        if (gameMode === 'multiples') {
            const nearestLess = Math.floor(hitBall.value / targetNumber) * targetNumber;
            const nearestMore = Math.ceil(hitBall.value / targetNumber) * targetNumber;
            const choice = Math.abs(hitBall.value - nearestLess) < Math.abs(hitBall.value - nearestMore) ? nearestLess : nearestMore;
            setActiveTip(`¡Cerca! ${targetNumber} x ${Math.round(choice/targetNumber)} es ${choice}`);
            setTimeout(() => setActiveTip(null), 3000);
        } else {
            setActiveTip(`El ${hitBall.value} no es divisible por ${targetNumber}`);
            setTimeout(() => setActiveTip(null), 3000);
        }
      }

      const energyLoss = Math.min(ENERGY_LOSS, 15 + (level - 1) * 2);
      setEnergy(e => Math.max(0, e - energyLoss)); 
      setScore(s => Math.max(0, s - 50));
      
      if(p) {
        const errorMsg = isMatch && isRightClick ? "¡USA CLICK IZQ!" : "¡USA CLICK DER!";
        spawnText(p.x, p.y - 30, errorMsg, "#f43f5e", 20, 'text');
        spawnParticles(p.x, p.y, "#f43f5e", 8); 
      }
      screenShakeRef.current = 6;
      
      speedPenaltyMultiplierRef.current = 2.0;
      setTimeout(() => { speedPenaltyMultiplierRef.current = 1; }, 500);
    }
    
    ballsRef.current = ballsRef.current.filter((_, idx) => idx !== ballIndex);
  };

  const update = () => {
    // Safety checks for Canvas existence
    if (gameState !== 'playing' || isPaused || !pathRef.current || pathRef.current.points.length === 0) return;

    const now = Date.now();
    
    // --- PERFORMANCE FIX: Only update state when frozen status actually changes ---
    const isFrozenActive = now < freezeEndTimeRef.current;
    if (isFrozenRef.current !== isFrozenActive) {
        isFrozenRef.current = isFrozenActive;
        setIsFrozen(isFrozenActive);
    }

    // 1. Spawning
    const ballSizePct = (BALL_DIAMETER + 5) / pathRef.current.totalLength;
    let canSpawn = false;
    if (ballsRef.current.length === 0) {
      canSpawn = true;
    } else {
      let tailBall = ballsRef.current[0];
      for(const b of ballsRef.current) {
        if (b.pos < tailBall.pos) tailBall = b;
      }
      if (tailBall.pos > ballSizePct) canSpawn = true;
    }

    if (canSpawn && progress < quota) {
      let isBonus = false;
      if (now - lastBonusSpawnTimeRef.current > BONUS_COOLDOWN) {
          if (Math.random() < 0.08) {
              isBonus = true;
              lastBonusSpawnTimeRef.current = now;
          }
      }
      
      ballsRef.current.push({
        id: ballCounterRef.current++,
        value: generateFairValue(targetNumber, gameMode, level),
        pos: 0, 
        color: isBonus ? BONUS_COLOR : COLORS[getRandomInt(0, COLORS.length - 1)],
        angle: 0,
        isBonus: isBonus
      });
    }

    // 2. Physics & Movement
    // PERFORMANCE: Removed redundant sort. Array order is maintained by physics and spawning.
    
    const freezeMultiplier = isFrozenActive ? 0.3 : 1;
    const baseSpeed = gameSpeedRef.current * speedPenaltyMultiplierRef.current * freezeMultiplier;
    
    if (ballsRef.current.length > 0) {
      ballsRef.current[0].pos += baseSpeed;
    }

    for (let i = 1; i < ballsRef.current.length; i++) {
      const leader = ballsRef.current[i-1];
      const follower = ballsRef.current[i];
      const idealPos = leader.pos - ballSizePct;
      
      if (follower.pos < idealPos) {
        const catchup = baseSpeed * CATCHUP_SPEED_MULTIPLIER; 
        follower.pos += catchup;
        if (follower.pos > idealPos) follower.pos = idealPos;
      } else {
        follower.pos = idealPos; 
      }
    }

    // 3. Game Over & Logic
    let gameOver = false;
    for (const b of ballsRef.current) {
      const pIdx = Math.floor(b.pos * (PATH_SAMPLES - 1));
      if (pIdx >= 0 && pIdx < PATH_SAMPLES - 1) {
        const p1 = pathRef.current.points[pIdx];
        const p2 = pathRef.current.points[pIdx+1];
        if (p1 && p2) b.angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
      }

      if (b.pos >= 1) {
         gameOver = true;
      }
    }

    if (gameOver || energy <= 0) { setGameState('gameover'); return; }

    // 4. Projectiles
    const nextProjectiles: Projectile[] = [];
    for (const p of projectilesRef.current) {
      p.trail.push({ x: p.x, y: p.y });
      if (p.trail.length > 6) p.trail.shift(); // Performance: reduced trail length

      p.x += p.vx;
      p.y += p.vy;
      
      let collided = false;
      if (p.x < 0 || p.x > dimensions.width || p.y < 0 || p.y > dimensions.height) {
        collided = true;
        // Missed shot: Reset combo
        if (comboRef.current > 0) {
          resetCombo();
          spawnText(p.x, p.y, "¡FALLO!", "#94a3b8", 16, 'text');
        }
      } else {
        for (let i = 0; i < ballsRef.current.length; i++) {
          const b = ballsRef.current[i];
          const idx = Math.floor(b.pos * (PATH_SAMPLES - 1));
          if (idx < 0 || idx >= pathRef.current.points.length) continue;
          
          const bp = pathRef.current.points[idx];
          const distSq = (p.x - bp.x)**2 + (p.y - bp.y)**2;
          
          if (distSq < (BALL_RADIUS * 1.5)**2) {
            handleHit(b, p, i);
            collided = true;
            break; 
          }
        }
      }
      if (!collided) nextProjectiles.push(p);
    }
    projectilesRef.current = nextProjectiles;

    // Performance: Limit number of effects to avoid memory leak
    if (effectsRef.current.length > 60) {
        effectsRef.current = effectsRef.current.slice(effectsRef.current.length - 60);
    }
    
    effectsRef.current = effectsRef.current.filter(e => {
      e.life -= 0.025;
      e.x += (e.vx || 0);
      e.y += (e.vy || 0);
      return e.life > 0;
    });

    if (screenShakeRef.current > 0) screenShakeRef.current -= 0.5;
    
    if (progress >= quota && ballsRef.current.length === 0) {
       setGameState('victory');
    }

    draw();
  };

  const updateRef = useRef(update);
  useEffect(() => { updateRef.current = update; });

  useEffect(() => {
    const loop = () => {
      if (updateRef.current) updateRef.current();
      requestRef.current = requestAnimationFrame(loop);
    };
    requestRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(requestRef.current);
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!ctx || !canvas) return;

    ctx.save();
    if (screenShakeRef.current > 0) ctx.translate((Math.random()-0.5)*screenShakeRef.current, (Math.random()-0.5)*screenShakeRef.current);

    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Freeze Overlay
    if (isFrozen) {
        ctx.fillStyle = 'rgba(6, 182, 212, 0.1)';
        ctx.fillRect(0,0, dimensions.width, dimensions.height);
    }

    // Path drawing (Optimized with Path2D)
    if (path2DRef.current) {
        ctx.strokeStyle = 'rgba(255,255,255,0.02)'; 
        ctx.lineWidth = BALL_DIAMETER + 10; 
        ctx.lineCap = 'round';
        ctx.stroke(path2DRef.current);

        ctx.strokeStyle = isFrozen ? 'rgba(6, 182, 212, 0.2)' : 'rgba(255,255,255,0.05)'; 
        ctx.lineWidth = BALL_DIAMETER;
        ctx.stroke(path2DRef.current);
    }

    const ep = pathRef.current.points[PATH_SAMPLES];
    if (ep) {
      ctx.beginPath(); ctx.fillStyle = '#000'; ctx.arc(ep.x, ep.y, BALL_RADIUS * 1.8 + Math.sin(Date.now()/150)*3, 0, Math.PI*2); ctx.fill();
      ctx.strokeStyle = '#f43f5e'; ctx.lineWidth = 3; ctx.setLineDash([5, 5]); ctx.stroke(); ctx.setLineDash([]);
    }

    // Balls
    ballsRef.current.forEach(b => {
      const idx = Math.floor(b.pos * (PATH_SAMPLES-1));
      if (idx < 0 || idx >= pathRef.current.points.length) return;
      const p = pathRef.current.points[idx];
      
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(b.angle); 
      
      // Bonus Pulse
      if (b.isBonus) {
        ctx.beginPath();
        ctx.fillStyle = `rgba(217, 70, 239, ${0.3 + Math.sin(Date.now() / 100) * 0.2})`;
        ctx.arc(0, 0, BALL_RADIUS + 4, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.beginPath(); ctx.fillStyle = b.color; ctx.arc(0, 0, BALL_RADIUS, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.fillStyle = 'rgba(255,255,255,0.2)'; ctx.arc(-5, -5, BALL_RADIUS/2, 0, Math.PI*2); ctx.fill();
      ctx.rotate(-b.angle); 
      ctx.fillStyle = '#fff'; ctx.font = 'bold 16px Inter'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      // Reduced shadow for performance
      ctx.fillText(b.value.toString(), 0, 1); 
      ctx.restore();
    });

    // Projectiles
    projectilesRef.current.forEach(p => {
      for (let i = 0; i < p.trail.length; i++) {
        const point = p.trail[i];
        const ratio = (i + 1) / p.trail.length;
        ctx.beginPath(); ctx.fillStyle = `rgba(56, 189, 248, ${ratio * 0.6})`; ctx.arc(point.x, point.y, 14 * ratio, 0, Math.PI * 2); ctx.fill();
      }
      // Performance: Removed expensive shadowBlur for moving projectiles
      ctx.beginPath(); ctx.fillStyle = '#fff'; ctx.arc(p.x, p.y, 14, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 2; ctx.arc(p.x, p.y, 14, 0, Math.PI*2); ctx.stroke();
    });

    effectsRef.current.forEach(e => {
      ctx.globalAlpha = e.life;
      if (e.type === 'particle') {
        ctx.beginPath(); ctx.fillStyle = e.color; ctx.arc(e.x, e.y, e.size || 3, 0, Math.PI*2); ctx.fill();
      } else {
        ctx.fillStyle = e.color; ctx.font = `900 ${e.type === 'combo' ? 38 : (e.size || 20)}px Inter`; ctx.textAlign = 'center'; ctx.fillText(e.text || '', e.x, e.y);
      }
    });
    ctx.globalAlpha = 1;

    // Shooter
    const cx = dimensions.width / 2;
    const cy = dimensions.height / 2;

    ctx.textAlign = 'center';
    ctx.font = '900 12px Inter';
    ctx.fillStyle = '#38bdf8';
    ctx.fillText('REGLA:', cx, cy - 90);
    ctx.fillStyle = '#fff';
    ctx.font = '900 22px Inter';
    const missionText = `${gameMode === 'multiples' ? 'MÚLTIPLOS' : 'DIVISORES'} DE ${targetNumber}`;
    ctx.fillText(missionText, cx, cy - 65);
    
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(shooterAngleRef.current);
    ctx.fillStyle = '#1e293b';
    ctx.beginPath(); ctx.roundRect(-22, -18, 65, 36, 12); ctx.fill();
    ctx.fillStyle = '#0ea5e9'; ctx.fillRect(38, -6, 10, 12);
    ctx.restore();
    
    ctx.beginPath(); ctx.fillStyle = '#0f172a'; ctx.strokeStyle = '#0ea5e9'; ctx.lineWidth = 5; ctx.arc(cx, cy, 40, 0, Math.PI*2); ctx.fill(); ctx.stroke();
    
    ctx.fillStyle = '#38bdf8'; ctx.font = '900 9px Inter'; ctx.fillText('OBJETIVO', cx, cy - 22);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 30px Inter'; ctx.fillText(targetNumber.toString(), cx, cy + 5);
    
    // ZUMA BAR
    const barW = Math.min(600, dimensions.width * 0.8);
    const barH = 20;
    const barX = (dimensions.width - barW) / 2;
    const barY = 80;
    
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath(); ctx.roundRect(barX, barY, barW, barH, 10); ctx.fill();
    
    const fillPct = Math.min(1, progress / quota);
    if (fillPct > 0) {
        // Performance: Removed expensive gradient creation inside the loop for the bar
        ctx.fillStyle = '#f59e0b';
        // Only use shadow if essential, removed here for speed
        ctx.beginPath(); ctx.roundRect(barX, barY, barW * fillPct, barH, 10); ctx.fill();
    }
    
    ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Inter'; ctx.textAlign = 'center';
    ctx.fillText(progress >= quota ? "¡ZUMA!" : `${progress} / ${quota}`, barX + barW/2, barY + 14);

    if (isPaused) { 
      ctx.fillStyle = 'rgba(2,6,23,0.8)'; ctx.fillRect(0,0,dimensions.width,dimensions.height); 
      ctx.fillStyle='#fff'; ctx.font='900 60px Inter'; ctx.fillText("PAUSA", cx, cy); 
    }
    ctx.restore();
  }, [gameState, targetNumber, gameMode, isPaused, energy, dimensions, progress, quota, isFrozen]);

  const startGame = (mode: GameMode | 'adventure') => {
    setScore(0);
    if (mode === 'adventure') {
      setIsAdventure(true);
      setGameMode('multiples');
      initLevel(1, 'multiples', 2, true);
    } else {
      setIsAdventure(false);
      setGameMode(mode);
      let target = undefined;
      if (customTarget && !isNaN(parseInt(customTarget))) {
          target = parseInt(customTarget);
      }
      initLevel(1, mode, target, true);
    }
    setGameState('flowchart');
  };

  const saveScore = async () => {
    if (!playerName.trim() || loadingScores) return;
    
    setLoadingScores(true);
    const newRecord: Omit<ScoreRecord, 'createdAt'> = {
      name: playerName.trim().toUpperCase(),
      score: score,
      mode: isAdventure ? 'adventure' : gameMode,
      target: isAdventure ? level : targetNumber,
      date: new Date().toLocaleDateString()
    };
    
    await ScoreService.saveScore(newRecord);
    setScoreSaved(true);
    if (isAdventure) setLeaderboardFilter('adventure');
    await refreshLeaderboard();
    setLoadingScores(false);
  };

  useEffect(() => {
    const checkFirebase = async () => {
      const db = await ScoreService.getDb();
      setFirebaseStatus(db ? 'connected' : 'disconnected');
    };
    checkFirebase();
  }, []);

  useEffect(() => {
    const checkFirebase = async () => {
      const db = await ScoreService.getDb();
      setFirebaseStatus(db ? 'connected' : 'disconnected');
    };
    checkFirebase();
  }, []);

  const refreshLeaderboard = async () => {
    setLoadingScores(true);
    try {
      const mode = leaderboardFilter === 'adventure' ? 'adventure' : undefined;
      const topScores = await ScoreService.getTopScores(10, mode);
      setLeaderboard(topScores);
    } finally {
      setLoadingScores(false);
    }
  };

  useEffect(() => {
    refreshLeaderboard();
  }, [leaderboardFilter]);

  const tutorialSteps = [
    { title: "Misión Matemática", desc: `Usa CLICK IZQUIERDO para disparar a los ${gameMode === 'multiples' ? 'MÚLTIPLOS' : 'DIVISORES'} de ${targetNumber}.`, icon: <MousePointer2 className="w-12 h-12 text-blue-400" /> },
    { title: "Limpieza de Errores", desc: "Usa CLICK DERECHO para eliminar los números que NO cumplen la regla. ¡Es vital para despejar el camino!", icon: <MousePointer2 className="w-12 h-12 text-rose-400 scale-x-[-1]" /> },
    { title: "Bolas Bonus", desc: "Las bolas VIOLETAS son especiales. Si las aciertas (con el botón correcto), ganarás muchos puntos y CONGELARÁS el tiempo.", icon: <Snowflake className="w-12 h-12 text-fuchsia-400" /> },
    { title: "Barra ZUMA", desc: "Acierta disparos a los números CORRECTOS para llenar la barra amarilla. Cuando se llene, dejarán de salir bolas.", icon: <Sparkles className="w-12 h-12 text-amber-400" /> },
    { title: "Peligro Mortal", desc: "¡Si CUALQUIER bola llega al agujero, PIERDES! Mantén el camino despejado usando ambos botones del mouse.", icon: <Skull className="w-12 h-12 text-rose-500" /> }
  ];

  return (
    <div className={`fixed inset-0 w-full h-full bg-slate-950 text-white font-sans flex flex-col items-center justify-center overflow-hidden touch-none selection:bg-blue-500/30 transition-colors duration-1000 ${isFrozen ? 'shadow-[inset_0_0_100px_rgba(6,182,212,0.3)]' : ''}`} onContextMenu={e => e.preventDefault()}>
      {gameState === 'playing' && (
        <div className="absolute inset-0 p-6 pointer-events-none z-10 flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div className="flex items-start gap-4">
              <button 
                onClick={() => {
                  if(confirm('¿Volver al menú principal?')) {
                    setGameState('menu');
                    setIsPaused(false);
                  }
                }}
                className="pointer-events-auto bg-slate-900/95 backdrop-blur-xl p-4 rounded-[1.5rem] border border-white/10 shadow-2xl hover:bg-slate-800 transition-all active:scale-95 group"
                title="Volver al Menú"
              >
                <Home className="w-6 h-6 text-slate-400 group-hover:text-white transition-colors" />
              </button>
              
              <div className="flex flex-col gap-2 text-left">
                <div key={`${level}-${targetNumber}`} className="bg-slate-900/95 backdrop-blur-xl p-5 rounded-3xl border-2 border-blue-500/50 shadow-2xl pointer-events-auto animate-pulse-glow transition-all">
                {isAdventure && (
                  <div className="flex items-center gap-1 bg-amber-500 text-slate-950 px-2 py-0.5 rounded-full text-[8px] font-black uppercase tracking-widest mb-2 w-fit">
                     <Flame className="w-2 h-2 fill-current" /> Modo Aventura
                  </div>
                )}
                <div className="flex items-center gap-2 mb-1"><Target className="w-5 h-5 text-blue-400"/><span className="text-slate-400 text-xs font-black uppercase tracking-widest">Nivel {level}</span></div>
                <h2 className="text-2xl font-black uppercase tracking-tight text-white">{gameMode === 'multiples' ? 'MÚLTIPLOS' : 'DIVISORES'} <span className="text-xs align-top text-slate-500 font-bold">DE</span> <span className="text-blue-400 text-4xl inline-block transform">{targetNumber}</span></h2>
                </div>
                {isFrozen && (
                  <div className="bg-cyan-500/20 backdrop-blur-md p-3 rounded-2xl border border-cyan-500/50 shadow-lg pointer-events-auto animate-pulse flex items-center gap-3">
                    <Snowflake className="w-6 h-6 text-cyan-300 animate-spin-slow" />
                    <div>
                      <div className="text-cyan-300 text-[10px] font-black uppercase tracking-widest">TIEMPO</div>
                      <div className="text-xl font-black text-white leading-none">CONGELADO</div>
                    </div>
                  </div>
                )}
                {comboDisplay > 1 && (
                  <div className="bg-amber-500/10 backdrop-blur-md p-3 rounded-2xl border border-amber-500/50 shadow-lg pointer-events-auto animate-bounce-slow flex items-center gap-3">
                    <Flame className="w-6 h-6 text-amber-500 animate-pulse" />
                    <div>
                      <div className="text-amber-500 text-[10px] font-black uppercase tracking-widest">RACHA</div>
                      <div className="text-2xl font-black text-amber-400 leading-none">x{comboDisplay}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className={`bg-slate-900/95 backdrop-blur-xl p-4 rounded-3xl border transition-all duration-300 shadow-2xl min-w-[140px] pointer-events-auto ${energy < 30 ? 'border-rose-500/50 shadow-rose-500/20 ring-1 ring-rose-500/10' : 'border-white/10'}`}>
              <div className="flex justify-between items-end mb-1">
                 <div className={`text-[10px] font-black uppercase transition-colors ${energy < 30 ? 'text-rose-400 animate-pulse' : 'text-slate-500'}`}>{energy < 30 ? '¡CRÍTICO!' : 'ENERGÍA'}</div>
                 <div className="text-slate-500 text-[10px] font-black uppercase text-right">Puntos</div>
              </div>
              <div className="text-3xl font-black text-right tabular-nums mb-2 text-white">{score.toLocaleString()}</div>
              
              <div className={`relative w-full bg-slate-950 h-3 rounded-full border border-white/5 overflow-visible ${energy < 30 ? 'animate-shake-bar' : ''}`}>
                  <motion.div 
                    className={`h-full rounded-full relative ${energy < 30 ? 'animate-flash-danger shadow-[0_0_15px_rgba(225,29,72,0.5)]' : 'bg-gradient-to-r from-blue-600 to-cyan-400'}`}
                    initial={false}
                    animate={{ width: `${Math.max(5, energy)}%` }}
                    transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  >
                      <div className="absolute top-0 right-0 w-full h-full bg-gradient-to-b from-white/20 to-transparent" />
                      {energy < 30 && (
                        <motion.div 
                          className="absolute inset-0 bg-white/20 rounded-full"
                          animate={{ opacity: [0, 0.4, 0] }}
                          transition={{ repeat: Infinity, duration: 0.5 }}
                        />
                      )}
                  </motion.div>
                  {/* Warning Icon for Low Energy */}
                  <AnimatePresence>
                    {energy < 30 && (
                      <motion.div 
                        initial={{ opacity: 0, scale: 0 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0 }}
                        className="absolute -right-1 -top-1"
                      >
                        <AlertCircle className="w-4 h-4 text-rose-500 fill-slate-950 animate-pulse" />
                      </motion.div>
                    )}
                  </AnimatePresence>
              </div>

              {/* Educational Tips & Combo Messages */}
              <AnimatePresence>
                {activeTip && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute -bottom-12 left-0 right-0 bg-slate-800 text-blue-300 py-2 px-4 rounded-xl text-[10px] font-bold border border-blue-500/30 text-center shadow-xl"
                  >
                    {activeTip}
                  </motion.div>
                )}
                {comboMessage && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.5, y: -20 }}
                    animate={{ opacity: 1, scale: 1.2, y: -40 }}
                    exit={{ opacity: 0, scale: 1.5, y: -60 }}
                    className="absolute -top-12 left-0 right-0 text-amber-400 font-black text-xl uppercase tracking-tighter text-center italic drop-shadow-[0_2px_10px_rgba(245,158,11,0.5)]"
                  >
                    {comboMessage}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="flex justify-center items-center pointer-events-auto">
            <button onClick={() => setIsPaused(!isPaused)} className="bg-slate-900/90 p-6 rounded-3xl border border-white/10 shadow-2xl active:scale-90 transition-all">
              {isPaused ? <PlayCircle className="w-8 h-8 text-emerald-400" /> : <Pause className="w-8 h-8 text-white" />}
            </button>
          </div>
          
          <div className="absolute bottom-6 left-6 pointer-events-none">
            <div className="bg-slate-900/80 backdrop-blur-md px-5 py-3 rounded-2xl border border-emerald-500/30 flex items-center gap-3 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
              <MousePointer2 className="w-5 h-5 text-emerald-400" />
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase text-emerald-400 leading-none">Click Izquierdo</span>
                <span className="text-[8px] font-bold text-emerald-500/70 uppercase">Correctos</span>
              </div>
            </div>
          </div>
          
          <div className="absolute bottom-6 right-6 pointer-events-none">
            <div className="bg-slate-900/80 backdrop-blur-md px-5 py-3 rounded-2xl border border-rose-500/30 flex items-center gap-3 shadow-[0_0_20px_rgba(244,63,94,0.1)]">
              <MousePointer2 className="w-5 h-5 text-rose-400 scale-x-[-1]" />
              <div className="flex flex-col">
                <span className="text-[10px] font-black uppercase text-rose-400 leading-none">Click Derecho</span>
                <span className="text-[8px] font-bold text-rose-500/70 uppercase">Incorrectos</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="absolute inset-0 w-full h-full" ref={containerRef}>
        <canvas ref={canvasRef} width={dimensions.width} height={dimensions.height} onMouseMove={onMove} onTouchMove={onMove} onMouseDown={onShoot} onTouchStart={onShoot} className={`block w-full h-full transition-all duration-700 ${gameState !== 'playing' ? 'opacity-20 blur-xl scale-95 pointer-events-none' : 'opacity-100 scale-100'}`} />

        {gameState === 'menu' && (
          <div className="absolute inset-0 flex flex-col items-center justify-start md:justify-center bg-slate-950/40 backdrop-blur-md px-6 py-12 overflow-y-auto text-center z-50 animate-in fade-in duration-500 scrollbar-hide">
            <div className="mb-6 p-6 bg-blue-600 rounded-[2rem] shadow-2xl animate-bounce-slow"><Zap className="w-16 h-16 text-white fill-current" /></div>
            <h1 className="text-6xl font-black mb-4 tracking-tighter uppercase text-white">Math Zuma</h1>
            <div className="w-full max-w-xs mb-8">
              <label className="text-slate-500 text-[10px] font-black uppercase block mb-3 tracking-widest">Número Base (Opcional)</label>
              <input type="number" placeholder="Aleatorio" value={customTarget} onChange={e => setCustomTarget(e.target.value)} className="w-full bg-slate-900 border border-white/10 rounded-2xl py-5 text-center font-black text-2xl focus:ring-2 focus:ring-blue-500/50 outline-none transition-all" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 w-full max-w-xl mb-4">
              <button 
                onClick={() => startGame('multiples')} 
                className="group p-8 bg-slate-900 border border-white/5 rounded-[2rem] hover:border-blue-500 transition-all active:scale-95 shadow-xl"
              >
                <Play className="w-8 h-8 text-blue-400 mb-2 mx-auto group-hover:scale-110 transition-transform" />
                <span className="font-black text-lg uppercase">Múltiplos</span>
              </button>
              <button 
                onClick={() => startGame('divisors')} 
                className="group p-8 bg-slate-900 border border-white/5 rounded-[2rem] hover:border-cyan-500 transition-all active:scale-95 shadow-xl"
              >
                <Target className="w-8 h-8 text-cyan-400 mb-2 mx-auto group-hover:scale-110 transition-transform" />
                <span className="font-black text-lg uppercase">Divisores</span>
              </button>
            </div>
            
            <button 
              onClick={() => startGame('adventure')} 
              className="w-full max-w-xl group p-8 bg-gradient-to-r from-blue-600 to-cyan-500 rounded-[2rem] shadow-[0_0_40px_rgba(59,130,246,0.3)] hover:scale-[1.02] active:scale-95 transition-all mb-8 overflow-hidden relative flex-shrink-0"
            >
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-20" />
              <div className="relative flex flex-col sm:flex-row items-center justify-center gap-4">
                <Flame className="w-10 h-10 text-white animate-pulse flex-shrink-0" />
                <div className="text-center sm:text-left flex flex-col">
                  <div className="text-white font-black text-2xl sm:text-3xl uppercase tracking-tighter leading-tight">Modo Aventura</div>
                  <div className="text-white/80 text-[10px] sm:text-xs font-bold uppercase tracking-widest leading-none mt-1">Dificultad Progresiva • Puntaje Acumulado</div>
                </div>
                <ArrowRight className="hidden sm:block w-8 h-8 text-white/50 group-hover:translate-x-2 transition-transform" />
              </div>
            </button>
            <div className="flex gap-4">
              <button onClick={() => { setTutorialStep(0); setGameState('tutorial'); }} className="px-8 py-3 bg-slate-800 rounded-xl font-black text-xs uppercase hover:bg-slate-700 transition-all">Guía</button>
              <button onClick={() => setGameState('leaderboard')} className="px-8 py-3 bg-slate-800 rounded-xl font-black text-xs uppercase hover:bg-slate-700 transition-all">Ranking</button>
            </div>
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="mt-8 flex flex-col items-center gap-2"
            >
              <div className="flex items-center gap-2 px-3 py-1 bg-slate-800/50 rounded-full border border-slate-700/50 backdrop-blur-sm">
                <div className={`w-2 h-2 rounded-full ${firebaseStatus === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]' : firebaseStatus === 'testing' ? 'bg-amber-500 animate-pulse' : 'bg-red-500'}`} />
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  {firebaseStatus === 'connected' ? 'Nube Conectada' : firebaseStatus === 'testing' ? 'Verificando Nube...' : 'Modo Sin Conexión'}
                </span>
              </div>
            </motion.div>
          </div>
        )}

        {gameState === 'flowchart' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-3xl p-6 text-center z-50 animate-in fade-in zoom-in duration-500">
            <h2 className="text-5xl font-black mb-8 text-blue-400 uppercase tracking-tighter">
              {isAdventure ? `AVENTURA: NIVEL ${level}` : 'Misión Matemática'}
            </h2>
            <div className="p-10 bg-slate-900 border-4 border-blue-500 rounded-[3rem] w-full max-w-md shadow-[0_0_80px_rgba(59,130,246,0.3)] animate-pulse-glow">
              <div className="text-xs font-black text-blue-300 uppercase mb-6 tracking-[0.2em]">OBJETIVO ACTIVO</div>
              <div className="text-4xl font-black mb-2 uppercase leading-none text-white">{gameMode === 'multiples' ? 'Múltiplos' : 'Divisores'}</div>
              <div className="text-xl font-black mb-6 text-slate-500 uppercase">DE</div>
              <div className="text-9xl font-black mb-8 text-transparent bg-clip-text bg-gradient-to-br from-blue-400 to-cyan-300 drop-shadow-2xl">{targetNumber}</div>
              <div className="flex gap-4">
                <div className="flex-1 p-5 bg-emerald-500/10 rounded-2xl border border-emerald-500/20">
                  <MousePointer2 className="w-8 h-8 text-emerald-400 mx-auto mb-2"/>
                  <div className="text-[10px] font-black text-emerald-400 uppercase">Click Izquierdo</div>
                  <div className="text-[8px] font-bold text-emerald-500/70 uppercase">Para Correctos</div>
                </div>
                <div className="flex-1 p-5 bg-rose-500/10 rounded-2xl border border-rose-500/20">
                  <MousePointer2 className="w-8 h-8 text-rose-400 mx-auto mb-2 scale-x-[-1]"/>
                  <div className="text-[10px] font-black text-rose-400 uppercase">Click Derecho</div>
                  <div className="text-[8px] font-bold text-rose-500/70 uppercase">Para Incorrectos</div>
                </div>
              </div>
            </div>
            <button onClick={() => setGameState('playing')} className="mt-12 px-20 py-6 bg-blue-600 rounded-3xl font-black text-3xl uppercase shadow-2xl active:scale-95 transition-all hover:bg-blue-500 border-b-8 border-blue-800 hover:border-blue-700 active:border-b-0 translate-y-0 active:translate-y-2">¡COMENZAR!</button>
          </div>
        )}

        {(gameState === 'gameover' || gameState === 'victory') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 backdrop-blur-3xl p-6 text-center z-50 animate-in fade-in duration-500">
            <div className={`mb-6 p-10 rounded-full border-4 ${gameState === 'gameover' ? 'bg-rose-500/20 border-rose-500/30 text-rose-500' : 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400'}`}>{gameState === 'gameover' ? <AlertTriangle className="w-20 h-20" /> : <Trophy className="w-20 h-20" />}</div>
            <h2 className={`text-7xl font-black mb-4 uppercase tracking-tighter ${gameState === 'gameover' ? 'text-rose-500' : 'text-emerald-400'}`}>{gameState === 'gameover' ? 'FALLO' : 'VICTORIA'}</h2>
            <div className="bg-slate-900 p-10 rounded-[3rem] border border-white/10 mb-10 w-full max-w-sm">
              <div className="text-slate-500 text-[10px] font-black uppercase mb-2">Puntos Obtenidos</div>
              <div className="text-6xl font-black text-blue-400 mb-8 tabular-nums">{score.toLocaleString()}</div>
              {!scoreSaved ? (
                <div className="space-y-4">
                  <input 
                    type="text" 
                    placeholder="Tu Nombre" 
                    value={playerName} 
                    onChange={e => setPlayerName(e.target.value)} 
                    maxLength={12} 
                    disabled={loadingScores}
                    className="w-full bg-slate-950 border border-white/5 rounded-2xl py-4 text-center font-black outline-none focus:ring-2 focus:ring-blue-500/50 transition-all disabled:opacity-50" 
                  />
                  <button 
                    onClick={saveScore} 
                    disabled={!playerName.trim() || loadingScores}
                    className="w-full py-5 bg-blue-600 rounded-2xl font-black text-sm uppercase shadow-xl active:scale-95 disabled:opacity-50 transition-all flex items-center justify-center gap-3"
                  >
                    {loadingScores && <Loader2 className="w-5 h-5 animate-spin" />}
                    {loadingScores ? 'Guardando...' : 'Guardar en Ranking'}
                  </button>
                </div>
              ) : (
                <div className="text-emerald-400 font-black text-sm uppercase flex items-center justify-center gap-2 animate-in slide-in-from-bottom duration-500">
                  <CheckCircle2 className="w-4 h-4"/> ¡Puntaje Guardado!
                </div>
              )}
            </div>
            <div className="flex gap-4">
              <button 
                onClick={() => {
                  if (gameState === 'victory') {
                    if (isAdventure) {
                      const nextLvl = level + 1;
                      const nextMode = nextLvl % 2 === 0 ? 'divisors' : 'multiples';
                      setGameMode(nextMode);
                      initLevel(nextLvl, nextMode, undefined, false); // false = keep score
                    } else {
                      initLevel(level + 1, gameMode); 
                    }
                  } else {
                    if (isAdventure) {
                      startGame('adventure');
                    } else {
                      initLevel(1, gameMode, targetNumber); 
                    }
                  }
                  setGameState('flowchart'); 
                }} 
                className="px-12 py-5 bg-blue-600 rounded-2xl font-black text-xl uppercase shadow-2xl hover:bg-blue-500 transition-colors"
              >
                {gameState === 'victory' ? 'Próximo' : 'Reintentar'}
              </button>
              <button onClick={() => setGameState('menu')} className="p-5 bg-slate-800 rounded-2xl hover:bg-slate-700 transition-colors"><Home className="w-8 h-8" /></button>
            </div>
          </div>
        )}

        {gameState === 'leaderboard' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-3xl p-6 text-center z-50 animate-in fade-in duration-300">
            <button onClick={() => setGameState('menu')} className="absolute top-8 right-8 p-3 bg-white/5 rounded-full hover:bg-white/10 transition-colors"><X className="w-6 h-6"/></button>
            <div className="w-full max-w-md h-[70vh] flex flex-col pt-8">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-4xl font-black uppercase text-amber-500 text-left">Top Pilotos</h2>
                </div>
                <button 
                  onClick={refreshLeaderboard} 
                  disabled={loadingScores}
                  className="p-3 bg-white/5 rounded-full hover:bg-white/10 transition-all active:rotate-180 disabled:opacity-50"
                  title="Actualizar"
                >
                  {loadingScores ? <Loader2 className="w-5 h-5 animate-spin"/> : <RefreshCw className="w-5 h-5"/>}
                </button>
              </div>

              {/* Leaderboard Tabs */}
              <div className="flex gap-2 mb-6 bg-slate-900 p-1 rounded-2xl border border-white/5">
                <button 
                  onClick={() => setLeaderboardFilter('all')}
                  className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all ${leaderboardFilter === 'all' ? 'bg-blue-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
                >
                  General
                </button>
                <button 
                  onClick={() => setLeaderboardFilter('adventure')}
                  className={`flex-1 py-3 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all flex items-center justify-center gap-2 ${leaderboardFilter === 'adventure' ? 'bg-amber-600 text-white shadow-lg' : 'text-slate-500 hover:text-white'}`}
                >
                  <Flame className={`w-3 h-3 ${leaderboardFilter === 'adventure' ? 'animate-pulse' : ''}`} />
                  Aventura
                </button>
              </div>

              <div className="text-[8px] font-bold text-slate-500 uppercase tracking-widest text-left mb-2 px-2 flex justify-between items-center">
                {leaderboard.length > 0 && !loadingScores ? (
                  <span className="flex items-center gap-1 text-emerald-500/70">
                    <span className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" /> Sincronizado
                  </span>
                ) : (
                  <span className="flex items-center gap-1">
                    <Loader2 className="w-2 h-2 animate-spin" /> Actualizando...
                  </span>
                )}
                <span>Top 10 Mundial</span>
              </div>
              <div className="flex-1 overflow-y-auto bg-slate-900/50 border border-white/5 rounded-3xl p-2 scrollbar-hide relative">
                {loadingScores && leaderboard.length === 0 ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center gap-4">
                    <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
                    <span className="text-slate-500 font-black uppercase text-xs">Cargando Ranking...</span>
                  </div>
                ) : leaderboard.length > 0 ? (
                  <table className="w-full text-left">
                    <thead><tr className="border-b border-white/5"><th className="p-4 text-[10px] text-slate-500 uppercase">#</th><th className="p-4 text-[10px] text-slate-500 uppercase">Nombre</th><th className="p-4 text-[10px] text-slate-500 text-right uppercase">Pts</th></tr></thead>
                    <tbody>
                      {leaderboard.map((r, i) => (
                        <tr key={i} className={`border-b border-white/5 transition-colors hover:bg-white/5 ${r.name === playerName ? 'bg-blue-500/10' : ''}`}>
                          <td className="p-4 font-black text-slate-700">{i+1}</td>
                          <td className="p-4">
                            <div className="font-black text-white text-sm uppercase">{r.name}</div>
                            <div className="text-[10px] text-slate-500 font-bold uppercase tracking-widest flex items-center gap-2">
                              {r.mode === 'adventure' ? (
                                <span className="flex items-center gap-1 text-amber-500">
                                  <Flame className="w-3 h-3" /> Aventura Lvl {r.target}
                                </span>
                              ) : (
                                <>{r.mode === 'multiples' ? 'Múltiplos' : 'Divisores'} de {r.target}</>
                              )}
                            </div>
                          </td>
                          <td className="p-4 font-black text-blue-400 text-right tabular-nums">
                            <div className="leading-none">{r.score.toLocaleString()}</div>
                            {r.mode === 'adventure' && (
                              <div className="text-[9px] text-amber-500/70 mt-1 uppercase">Lvl {r.target}</div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="p-20 text-slate-700 uppercase font-black">Sin Puntajes</div>
                )}
              </div>
              <button onClick={() => setGameState('menu')} className="mt-8 py-4 bg-slate-800 rounded-2xl font-black uppercase text-xs hover:bg-slate-700 transition-colors">Volver al Menú</button>
            </div>
          </div>
        )}

        {gameState === 'tutorial' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-3xl p-6 text-center z-50 animate-in fade-in duration-300">
            <button onClick={() => setGameState('menu')} className="absolute top-8 right-8 p-3 bg-white/5 rounded-full"><X className="w-6 h-6"/></button>
            <div className="max-w-md w-full flex flex-col items-center">
              <div className="mb-8 p-12 bg-blue-600/20 rounded-[4rem] border border-blue-500/30 animate-pulse">{tutorialSteps[tutorialStep].icon}</div>
              <h2 className="text-4xl font-black mb-4 uppercase text-blue-400 tracking-tighter">{tutorialSteps[tutorialStep].title}</h2>
              <p className="text-slate-400 text-xl leading-relaxed mb-10">{tutorialSteps[tutorialStep].desc}</p>
              <div className="flex items-center gap-6 w-full justify-between"><button disabled={tutorialStep === 0} onClick={() => setTutorialStep(s => s - 1)} className="p-5 bg-slate-800 rounded-2xl disabled:opacity-20 active:scale-90 transition-all"><ChevronLeft/></button><div className="flex gap-2">{tutorialSteps.map((_, i) => <div key={i} className={`h-2 rounded-full transition-all ${i === tutorialStep ? 'w-10 bg-blue-500' : 'w-2 bg-slate-800'}`} />)}</div>{tutorialStep < tutorialSteps.length - 1 ? <button onClick={() => setTutorialStep(s => s + 1)} className="p-5 bg-blue-600 rounded-2xl active:scale-90 transition-all"><ChevronRight/></button> : <button onClick={() => setGameState('menu')} className="px-10 py-5 bg-emerald-600 rounded-2xl font-black text-xs uppercase shadow-2xl active:scale-90 transition-all">Listo</button>}</div>
            </div>
          </div>
        )}
      </div>

      <div className="absolute bottom-6 right-8 text-[12px] font-black uppercase tracking-[0.2em] text-slate-500 hover:text-blue-400 transition-colors pointer-events-none z-[60] text-right">
        <div className="text-[8px] text-slate-700 mb-1 opacity-50">Desarrollado</div>
        Por YherreraR
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
        body { margin: 0; background: #020617; font-family: 'Inter', sans-serif; cursor: crosshair; user-select: none; overflow: hidden; }
        canvas { display: block; image-rendering: pixelated; }
        .animate-bounce-slow { animation: bounce 4s infinite ease-in-out; }
        @keyframes bounce { 0%, 100% { transform: translateY(-3%); } 50% { transform: translateY(0); } }
        .scrollbar-hide::-webkit-scrollbar { display: none; }
        .scrollbar-hide { -ms-overflow-style: none; scrollbar-width: none; }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
        @keyframes pulse-glow { 
          0%, 100% { box-shadow: 0 0 15px -5px rgba(59, 130, 246, 0.3); border-color: rgba(59, 130, 246, 0.3); transform: scale(1); } 
          50% { box-shadow: 0 0 30px -5px rgba(59, 130, 246, 0.6); border-color: rgba(59, 130, 246, 0.8); transform: scale(1.02); } 
        }
        .animate-pulse-glow { animation: pulse-glow 3s infinite ease-in-out; }
        .animate-spin-slow { animation: spin 8s linear infinite; }
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes flash-danger { 
          0%, 100% { background-color: #ef4444; box-shadow: 0 0 10px #ef4444; } 
          50% { background-color: #f87171; box-shadow: 0 0 20px #f87171; } 
        }
        .animate-flash-danger { animation: flash-danger 0.5s infinite; }
        @keyframes shake-bar {
          0%, 100% { transform: translateX(0); }
          25% { transform: translateX(-2px); }
          75% { transform: translateX(2px); }
        }
        .animate-shake-bar { animation: shake-bar 0.2s infinite; }
      `}</style>
    </div>
  );
};

const root = document.getElementById('root');
if (root) createRoot(root).render(<ZumaMathGame />);
