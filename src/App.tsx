import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'

type Cell = 0 | 1 | 2 // 0 empty, 1 player (black), 2 AI (white)
type Player = 1 | 2

type Difficulty = 'easy' | 'normal' | 'hard'

interface MoveRecord {
  index: number
  x: number
  y: number
  player: Player
  scoreDelta: number
  pattern: string
}

interface HistoryGame {
  id: string
  createdAt: number
  difficulty: Difficulty
  moves: MoveRecord[]
  winner: Player | 0
  winLine: [number, number][]
  totalScore: number
}

/** 从棋谱累加双方盘面评分（用于历史对抗展示） */
function scoresFromMoves(moves: MoveRecord[]): { you: number; ai: number } {
  let you = 0
  let ai = 0
  for (const m of moves) {
    if (m.player === 1) you += m.scoreDelta
    else ai += m.scoreDelta
  }
  return { you, ai }
}

const HISTORY_KEY = 'gomoku_history_v1'

const BOARD_SIZE = 15
const WIN_COUNT = 5

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const

function createEmptyBoard(): Cell[] {
  return new Array(BOARD_SIZE * BOARD_SIZE).fill(0)
}

function boardFromMoves(moves: MoveRecord[], step: number): Cell[] {
  const b = createEmptyBoard()
  const upto = Math.max(0, Math.min(step, moves.length))
  for (let i = 0; i < upto; i++) {
    const m = moves[i]
    b[indexOf(m.x, m.y)] = m.player
  }
  return b
}

function indexOf(x: number, y: number): number {
  return y * BOARD_SIZE + x
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE
}

function checkWin(board: Cell[], lastX: number, lastY: number, player: Player) {
  for (const [dx, dy] of DIRS) {
    let count = 1
    const line: [number, number][] = [[lastX, lastY]]
    // forward
    let x = lastX + dx
    let y = lastY + dy
    while (inBounds(x, y) && board[indexOf(x, y)] === player) {
      line.push([x, y])
      count++
      x += dx
      y += dy
    }
    // backward
    x = lastX - dx
    y = lastY - dy
    while (inBounds(x, y) && board[indexOf(x, y)] === player) {
      line.unshift([x, y])
      count++
      x -= dx
      y -= dy
    }
    if (count >= WIN_COUNT) {
      return { winner: player, line }
    }
  }
  return null
}

/** 终局棋盘上有胜者但 winLine 未存时，从盘面反推一条五连（用于旧存档或异常状态） */
function findWinningLineFromBoard(
  board: Cell[],
  player: Player,
): [number, number][] | null {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      if (board[indexOf(x, y)] !== player) continue
      const w = checkWin(board, x, y, player)
      if (w) return w.line
    }
  }
  return null
}

interface ScoredMove {
  x: number
  y: number
  score: number
  pattern: string
}

const PATTERN_SCORES: { pattern: RegExp; self: number; opp: number; name: string }[] = [
  { pattern: /11111/, self: 200000, opp: 200000, name: '成五' },
  { pattern: /011110/, self: 42000, opp: 52000, name: '活四' },
  { pattern: /211110|011112/, self: 16000, opp: 22000, name: '冲四' },
  { pattern: /01110/, self: 7000, opp: 9000, name: '活三' },
  { pattern: /010110|011010/, self: 4200, opp: 5600, name: '跳三' },
  { pattern: /001112|211100|010112|211010|011012|210110/, self: 2000, opp: 2600, name: '眠三' },
  { pattern: /001110|011100|0101100|0010110/, self: 3200, opp: 4200, name: '潜在活三' },
]

type PatternId =
  | '成五'
  | '活四'
  | '冲四'
  | '活三'
  | '跳三'
  | '眠三'
  | '潜在活三'
  | '活二'
  | '眠二'
  | '对手活四'
  | '对手冲四'
  | '对手活三'
  | '对手跳三'
  | '对手眠三'
  | '阻断活四'
  | '阻断冲四'
  | '阻断活三'
  | '交替争夺'
  | '黑白互扳'
  | '挡中带攻'
  | '对拉战线'
  | '攻防换手'
  | '要点接触战'
  | '势力纠缠'
  | '跳挡交手'
  | '正面对冲'

/** 0 空 · 1 我方（黑）· 2 对手（白） */
type CatalogCell = 0 | 1 | 2

const PATTERN_CATALOG: {
  id: PatternId
  kind: '进攻' | '防守' | '对手' | '交手'
  name: string
  scoreShow: number
  description: string
  template: CatalogCell[]
}[] = [
  {
    id: '成五',
    kind: '进攻',
    name: '成五',
    scoreShow: 2000,
    description: '五连成形，直接决定胜负。',
    template: [1, 1, 1, 1, 1],
  },
  {
    id: '活四',
    kind: '进攻',
    name: '活四',
    scoreShow: 450,
    description: '连续四子且两端均可延伸，下一手形成成五威胁极强。',
    template: [0, 1, 1, 1, 1],
  },
  {
    id: '冲四',
    kind: '进攻',
    name: '冲四',
    scoreShow: 220,
    description: '四子连成一端封口，另一端可下成五，逼迫对方应对。',
    template: [1, 1, 1, 1, 0],
  },
  {
    id: '活三',
    kind: '进攻',
    name: '活三',
    scoreShow: 140,
    description: '活三可延伸为活四/成五，是常见进攻骨架。',
    template: [0, 1, 1, 1, 0],
  },
  {
    id: '跳三',
    kind: '进攻',
    name: '跳三',
    scoreShow: 95,
    description: '中间有空位的三子结构，可发展为更强威胁。',
    template: [1, 1, 0, 1, 0],
  },
  {
    id: '眠三',
    kind: '进攻',
    name: '眠三',
    scoreShow: 60,
    description: '一端被挡的三子，需对方失误或你方连续施压才易成势。',
    template: [1, 1, 1, 0, 0],
  },
  {
    id: '潜在活三',
    kind: '进攻',
    name: '潜在活三',
    scoreShow: 80,
    description: '尚未定型但子力在一条线上，再进一手可转入活三体系。',
    template: [0, 1, 1, 0, 1],
  },
  {
    id: '活二',
    kind: '进攻',
    name: '活二',
    scoreShow: 35,
    description: '两子相连且两侧有空间，是构筑更大棋形的起点。',
    template: [0, 1, 1, 0, 0],
  },
  {
    id: '眠二',
    kind: '进攻',
    name: '眠二',
    scoreShow: 18,
    description: '一端被挡的二子，局部压力较小，多用于铺垫。',
    template: [1, 1, 0, 0, 0],
  },
  {
    id: '对手活四',
    kind: '对手',
    name: '对手活四（需防）',
    scoreShow: 520,
    description: '对方走出活四，下一手即可成五，通常必须立即封堵或反杀。',
    template: [0, 2, 2, 2, 2],
  },
  {
    id: '对手冲四',
    kind: '对手',
    name: '对手冲四（需防）',
    scoreShow: 220,
    description: '对方四连一端封口，另一端成五威胁，防守压力大。',
    template: [2, 2, 2, 2, 0],
  },
  {
    id: '对手活三',
    kind: '对手',
    name: '对手活三',
    scoreShow: 90,
    description: '对方活三正在成形，需抢占要点或牵制，避免其升为活四。',
    template: [0, 2, 2, 2, 0],
  },
  {
    id: '对手跳三',
    kind: '对手',
    name: '对手跳三',
    scoreShow: 56,
    description: '对方带跳的活三雏形，注意其转向与连冲。',
    template: [2, 2, 0, 2, 0],
  },
  {
    id: '对手眠三',
    kind: '对手',
    name: '对手眠三',
    scoreShow: 40,
    description: '对方眠三威胁相对软，但仍需防止其与其他子力连接。',
    template: [2, 2, 2, 0, 0],
  },
  {
    id: '阻断活四',
    kind: '防守',
    name: '阻断对方活四',
    scoreShow: 480,
    description: '在对方活四延伸点上落子（黑），直接化解成五威胁。',
    template: [1, 2, 2, 2, 0],
  },
  {
    id: '阻断冲四',
    kind: '防守',
    name: '阻断对方冲四',
    scoreShow: 260,
    description: '堵住对方冲四的成五点，典型“必应手”。',
    template: [2, 2, 2, 0, 1],
  },
  {
    id: '阻断活三',
    kind: '防守',
    name: '阻断对方活三',
    scoreShow: 120,
    description: '在对方活三一侧落子干扰其延展，争取先手或转入对攻。',
    template: [1, 0, 2, 2, 2],
  },
  {
    id: '交替争夺',
    kind: '交手',
    name: '交替争夺要点',
    scoreShow: 85,
    description:
      '黑白沿一线交替落子，争夺延伸权与先手；演示为序盘常见「你一手我一手」的接触战。',
    template: [1, 2, 1, 2, 1, 0, 0],
  },
  {
    id: '黑白互扳',
    kind: '交手',
    name: '黑白互扳',
    scoreShow: 72,
    description: '双方在空位两侧各成小块势力，互相牵制，谁抢先手谁占优。',
    template: [1, 2, 0, 1, 2],
  },
  {
    id: '挡中带攻',
    kind: '交手',
    name: '挡中带攻',
    scoreShow: 88,
    description: '在对方压力点旁落子既挡其发展，又保留己方反击线路，典型攻防一体。',
    template: [2, 1, 0, 2, 0, 1],
  },
  {
    id: '对拉战线',
    kind: '交手',
    name: '对拉战线',
    scoreShow: 70,
    description: '中间空档成为双方拉扯空间，黑先白应，战线在「拉」与「挡」之间移动。',
    template: [0, 1, 2, 1, 2, 1, 0],
  },
  {
    id: '攻防换手',
    kind: '交手',
    name: '攻防换手',
    scoreShow: 78,
    description: '空位隔开的多枚子力，体现一方进攻、对方应手后再转守为攻的节奏。',
    template: [1, 0, 2, 0, 1, 2, 1],
  },
  {
    id: '要点接触战',
    kind: '交手',
    name: '要点接触战',
    scoreShow: 92,
    description: '双方在一条线上多次接触，空点即「要点」：谁占到谁掌握局部主动。',
    template: [1, 2, 0, 0, 1, 2, 1, 0, 0],
  },
  {
    id: '势力纠缠',
    kind: '交手',
    name: '势力纠缠',
    scoreShow: 65,
    description: '黑白子力交错，尚未分出清晰外势，后续一手可能打破平衡。',
    template: [2, 2, 1, 0, 1, 1],
  },
  {
    id: '跳挡交手',
    kind: '交手',
    name: '跳挡与反击',
    scoreShow: 68,
    description: '利用空位跳挡对方，同时预留己方连接；常见于中盘纠缠。',
    template: [1, 0, 2, 1, 0, 2],
  },
  {
    id: '正面对冲',
    kind: '交手',
    name: '正面对冲',
    scoreShow: 75,
    description: '双方连续子力正面顶在一起，比的是下一手的速度与方向选择。',
    template: [1, 1, 2, 2, 1, 2],
  },
]

/** 招式演示：棋盘中央横排，template 从左到右、长度可变 */
const CATALOG_DEMO_Y = 7

type CatalogSlot = { x: number; y: number; player: Player }

function catalogDemoStartX(templateLen: number): number {
  if (templateLen <= 0) return 0
  const len = Math.min(templateLen, BOARD_SIZE)
  return Math.max(0, Math.round((BOARD_SIZE - len) / 2))
}

function catalogStoneSlots(template: CatalogCell[]): CatalogSlot[] {
  const startX = catalogDemoStartX(template.length)
  const slots: CatalogSlot[] = []
  for (let i = 0; i < template.length; i++) {
    const t = template[i]
    if (t === 1 || t === 2) {
      slots.push({ x: startX + i, y: CATALOG_DEMO_Y, player: t })
    }
  }
  return slots
}

function evaluateLine(line: Cell[], who: Player, opp: Player) {
  const s = line.map((c) => (c === who ? '1' : c === opp ? '2' : '0')).join('')
  let best = { score: 0, pattern: '' }
  for (const p of PATTERN_SCORES) {
    if (p.pattern.test(s)) {
      const score = p.self
      if (score > best.score) best = { score, pattern: p.name }
    }
  }
  const sOpp = line.map((c) => (c === opp ? '1' : c === who ? '2' : '0')).join('')
  for (const p of PATTERN_SCORES) {
    if (p.pattern.test(sOpp)) {
      const score = p.opp
      if (score > best.score) best = { score, pattern: '阻断 ' + p.name }
    }
  }
  return best
}

function evaluateBoardAt(board: Cell[], x: number, y: number, who: Player): ScoredMove {
  const idx = indexOf(x, y)
  if (board[idx] !== 0) return { x, y, score: -Infinity, pattern: '' }
  const temp = board.slice()
  temp[idx] = who
  const opp: Player = who === 1 ? 2 : 1
  let totalScore = 0
  let bestPattern = ''

  for (const [dx, dy] of DIRS) {
    const line: Cell[] = []
    for (let offset = -4; offset <= 4; offset++) {
      const xx = x + dx * offset
      const yy = y + dy * offset
      if (inBounds(xx, yy)) {
        line.push(temp[indexOf(xx, yy)])
      }
    }
    if (line.length >= 5) {
      const { score, pattern } = evaluateLine(line, who, opp)
      if (score > 0) {
        totalScore += score
        if (score > 0 && !bestPattern) bestPattern = pattern
      }
    }
  }

  // slight preference to center
  const center = (BOARD_SIZE - 1) / 2
  const distCenter = Math.abs(x - center) + Math.abs(y - center)
  totalScore += Math.max(0, 10 - distCenter)

  return { x, y, score: totalScore, pattern: bestPattern }
}

/** 只考虑已有子邻域内的空点，减少搜索量；盘面全空时仅保留天元附近一手（白方不应遇全空，但防御性保留） */
function generateMoveCandidates(
  b: Cell[],
  who: Player,
  radius: number,
  limit: number,
): ScoredMove[] {
  let stoneCount = 0
  for (let i = 0; i < b.length; i++) if (b[i] !== 0) stoneCount++

  const res: ScoredMove[] = []
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const idx = indexOf(x, y)
      if (b[idx] !== 0) continue

      let hasNeighbor = false
      if (stoneCount === 0) {
        const c = (BOARD_SIZE - 1) / 2
        if (Math.abs(x - c) <= 1 && Math.abs(y - c) <= 1) hasNeighbor = true
      } else {
        for (let dy = -radius; dy <= radius && !hasNeighbor; dy++) {
          for (let dx = -radius; dx <= radius && !hasNeighbor; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (inBounds(nx, ny) && b[indexOf(nx, ny)] !== 0) {
              hasNeighbor = true
            }
          }
        }
      }
      if (!hasNeighbor) continue

      res.push(evaluateBoardAt(b, x, y, who))
    }
  }
  res.sort((a, b2) => b2.score - a.score)
  return res.slice(0, limit)
}

/** 局面估值：AI（白）视角，越大越有利。基于双方当前最强一手威胁差（五子棋常用静态启发）。 */
function staticEvalForAI(b: Cell[]): number {
  const ai = 2 as Player
  const opp = 1 as Player
  const my = generateMoveCandidates(b, ai, 3, 22)
  const op = generateMoveCandidates(b, opp, 3, 22)
  const myS = my.length ? my[0].score : 0
  const opS = op.length ? op[0].score : 0
  return myS - opS * 0.99
}

const MM_WIN = 8_000_000
const MM_LOSS = -8_000_000

/** minimax + α-β；aiTurn=true 表示轮到 AI（白方）。depth 为剩余半回合数，到 0 返回静态估值。 */
function minimaxAB(
  b: Cell[],
  depth: number,
  aiTurn: boolean,
  alpha: number,
  beta: number,
): number {
  if (depth === 0) return staticEvalForAI(b)

  const player: Player = aiTurn ? 2 : 1
  const branch =
    depth >= 3 ? 11 : depth >= 2 ? 13 : 15
  const moves = generateMoveCandidates(b, player, 3, branch)
  if (!moves.length) return staticEvalForAI(b)

  const tieDepth = (4 - depth) * 120

  if (aiTurn) {
    let maxEval = MM_LOSS
    for (const m of moves) {
      const nb = b.slice()
      const i = indexOf(m.x, m.y)
      nb[i] = player
      if (checkWin(nb, m.x, m.y, 2)) return MM_WIN - tieDepth
      const ev = minimaxAB(nb, depth - 1, false, alpha, beta)
      maxEval = Math.max(maxEval, ev)
      alpha = Math.max(alpha, ev)
      if (beta <= alpha) break
    }
    return maxEval
  }

  let minEval = MM_WIN
  for (const m of moves) {
    const nb = b.slice()
    nb[indexOf(m.x, m.y)] = player
    if (checkWin(nb, m.x, m.y, 1)) return MM_LOSS + tieDepth
    const ev = minimaxAB(nb, depth - 1, true, alpha, beta)
    minEval = Math.min(minEval, ev)
    beta = Math.min(beta, ev)
    if (beta <= alpha) break
  }
  return minEval
}

function pickBestMoveMinimax(board: Cell[], plyDepth: number): ScoredMove | null {
  const ai = 2 as Player
  const moves = generateMoveCandidates(board, ai, 3, 16)
  if (!moves.length) return null
  let best: ScoredMove = moves[0]!
  let bestScore = MM_LOSS

  for (const m of moves) {
    const nb = board.slice()
    nb[indexOf(m.x, m.y)] = ai
    if (checkWin(nb, m.x, m.y, ai)) return { ...m, score: 1e12, pattern: '立即成五' }
    const sc = minimaxAB(nb, plyDepth - 1, false, MM_LOSS, MM_WIN)
    if (sc > bestScore) {
      bestScore = sc
      best = m
    }
  }
  return best
}

/** 简单：仍带一点随机性，但明显偏向高分点；必胜/必防与所有难度一致，不随机犯错。 */
function pickEasyNonForced(candidates: ScoredMove[]): ScoredMove {
  const top = candidates.slice(0, 8)
  if (top.length <= 1) return top[0]!
  const r = Math.random()
  if (r < 0.52) return top[0]!
  if (r < 0.8) return top[1] ?? top[0]!
  if (r < 0.92) return top[2] ?? top[0]!
  const k = 3 + Math.floor(Math.random() * Math.min(5, top.length - 3))
  return top[k] ?? top[0]!
}

function chooseAIMove(board: Cell[], difficulty: Difficulty): ScoredMove | null {
  const ai: Player = 2
  const opp: Player = 1

  const candidates = generateMoveCandidates(board, ai, 3, 44)
  if (!candidates.length) {
    const c = Math.floor(BOARD_SIZE / 2)
    return evaluateBoardAt(board, c, c, ai)
  }

  // 1) 立即成五
  for (const m of candidates.slice(0, 32)) {
    const tmp = board.slice()
    tmp[indexOf(m.x, m.y)] = ai
    const win = checkWin(tmp, m.x, m.y, ai)
    if (win) return { ...m, score: 1e12, pattern: '立即成五' }
  }

  // 2) 对方下一手可成五：必防点（各难度均选最强封堵，不故意放水）
  const threatBlocks: ScoredMove[] = []
  for (const m of candidates.slice(0, 32)) {
    const tmp = board.slice()
    tmp[indexOf(m.x, m.y)] = opp
    const win = checkWin(tmp, m.x, m.y, opp)
    if (win) {
      threatBlocks.push({ ...m, score: m.score + 200000 })
    }
  }
  if (threatBlocks.length) {
    threatBlocks.sort((a, b) => b.score - a.score)
    return threatBlocks[0]
  }

  // 3) 无紧迫胜负：按难度搜索
  if (difficulty === 'easy') {
    return pickEasyNonForced(candidates)
  }

  if (difficulty === 'normal') {
    // 2 层：AI 一手 + 对方应手 + 静态估值（弱于困难档的层数与分支）
    const pick = pickBestMoveMinimax(board, 2)
    return pick ?? candidates[0]
  }

  // 困难：4 层 minimax + α-β（双方各两手），明显强于原「单步对手启发」
  const pick = pickBestMoveMinimax(board, 4)
  return pick ?? candidates[0]
}

function PatternPreview({ template }: { template: CatalogCell[] }) {
  const gid = useId().replace(/:/g, '')
  const n = Math.max(template.length, 1)
  const pad = 10
  const step =
    n <= 1 ? 0 : Math.min(20, Math.max(11, Math.floor(96 / Math.max(n - 1, 1))))
  const innerW = n <= 1 ? 0 : (n - 1) * step
  const vbW = Math.max(120, pad * 2 + innerW)
  const lineEnd = vbW - pad
  return (
    <div className="pattern-preview" aria-hidden="true">
      <svg
        className="pattern-preview-svg"
        viewBox={`0 0 ${vbW} 52`}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <linearGradient id={`previewGrad-${gid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.95" />
          </linearGradient>
        </defs>
        <path
          className="pattern-sweep"
          d={`M${pad} 26 H${lineEnd}`}
          stroke={`url(#previewGrad-${gid})`}
          strokeWidth="6"
          strokeLinecap="round"
        />
        {template.map((v, i) => {
          const cx = pad + (n <= 1 ? 0 : i * step)
          if (v === 0) {
            return (
              <circle key={i} cx={cx} cy="26" r={5} className="pattern-dot off" />
            )
          }
          return (
            <circle
              key={i}
              cx={cx}
              cy="26"
              r={7}
              className={v === 1 ? 'pattern-dot on pattern-dot-black' : 'pattern-dot on pattern-dot-white'}
            />
          )
        })}
      </svg>
    </div>
  )
}

function App() {
  type ViewMode = 'play' | 'history' | 'catalog'
  const [viewMode, setViewMode] = useState<ViewMode>('play')

  const [board, setBoard] = useState<Cell[]>(() => createEmptyBoard())
  const [currentPlayer, setCurrentPlayer] = useState<Player>(1)
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [winner, setWinner] = useState<Player | 0>(0)
  const [winLine, setWinLine] = useState<[number, number][]>([])
  const [moveHistory, setMoveHistory] = useState<MoveRecord[]>([])
  /** 与棋谱一致累加，避免 AI 落子在 setTimeout 里时与独立 totalScore 状态不同步 */
  const totalScore = useMemo(
    () => moveHistory.reduce((sum, m) => sum + m.scoreDelta, 0),
    [moveHistory],
  )
  const [hintTarget, setHintTarget] = useState<{ x: number; y: number } | null>(null)
  const [mounted, setMounted] = useState(false)
  const [boardKick, setBoardKick] = useState<0 | 1>(0)
  const boardWrapRef = useRef<HTMLDivElement | null>(null)
  /** 与 div.board 可视边长一致，用于同步 --boardPx（较 wrap 减 padding 更准确） */
  const boardMeasureRef = useRef<HTMLDivElement | null>(null)
  /** 左侧整列 section.board-zone，用于侧栏与栅格行同高（比只量 board-wrap 更贴近实际行盒） */
  const boardZoneRef = useRef<HTMLElement | null>(null)
  /** 棋盘+侧栏所在行，用于与左侧同高时吸收子像素行高 */
  const mainTopRowRef = useRef<HTMLDivElement | null>(null)
  /** 与 div.board 实际边长一致（board-wrap 减去 board-container 的 18px×2 padding） */
  const [boardPx, setBoardPx] = useState(640)
  /** 与左侧 .board-zone 同高（侧栏 height，与棋盘列底缘对齐） */
  const [boardWrapOuterHeight, setBoardWrapOuterHeight] = useState(0)
  const viewModeRef = useRef<ViewMode>(viewMode)
  viewModeRef.current = viewMode
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null)
  const [resultFlash, setResultFlash] = useState<{ text: string; show: boolean } | null>(
    null,
  )
  const [aboutVisible, setAboutVisible] = useState(false)
  const [aboutLeaving, setAboutLeaving] = useState(false)
  const aboutCloseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [aboutBtnPulse, setAboutBtnPulse] = useState(false)

  const [historyGames, setHistoryGames] = useState<HistoryGame[]>(() => {
    try {
      const raw = localStorage.getItem(HISTORY_KEY)
      const parsed = raw ? (JSON.parse(raw) as HistoryGame[]) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  })
  const [selectedHistoryIndex, setSelectedHistoryIndex] = useState<number>(-1)
  const [historySelectedIds, setHistorySelectedIds] = useState<string[]>([])
  /** 删除记录模式：显示多选框与工具条，卡片右移 */
  const [historyDeleteMode, setHistoryDeleteMode] = useState(false)
  /** 人机 / 历史 / 招式切换时主区动效 */
  const [viewSwitchAnim, setViewSwitchAnim] = useState(false)
  const [replayStep, setReplayStep] = useState<number>(0)
  const [replayPlaying, setReplayPlaying] = useState<boolean>(false)

  const [catalogDetailId, setCatalogDetailId] = useState<PatternId | null>(null)
  const [catalogAnimFrame, setCatalogAnimFrame] = useState(0)
  const catalogLineGradId = useId().replace(/:/g, '')

  const [sessionId, setSessionId] = useState(() => String(Date.now()))
  const savedForSessionRef = useRef<string | null>(null)
  const wasHistoryViewRef = useRef(false)
  const skipFirstViewSwitchAnimRef = useRef(true)

  /** 历史查看：未点选时默认最近一局，对抗条与棋盘即可显示终局数据 */
  const resolvedHistoryIndex = useMemo(() => {
    if (historyGames.length === 0) return -1
    if (selectedHistoryIndex >= 0 && selectedHistoryIndex < historyGames.length) {
      return selectedHistoryIndex
    }
    return historyGames.length - 1
  }, [historyGames, selectedHistoryIndex])

  const activeHistory: HistoryGame | null =
    viewMode === 'history' && resolvedHistoryIndex >= 0
      ? historyGames[resolvedHistoryIndex]
      : null

  const replayMoves = activeHistory?.moves ?? []
  const duelScores = useMemo(() => {
    const moves =
      viewMode === 'history' ? replayMoves.slice(0, replayStep) : moveHistory
    return scoresFromMoves(moves)
  }, [viewMode, replayMoves, replayStep, moveHistory])

  const catalogDemoTemplate = useMemo(() => {
    if (viewMode !== 'catalog' || !catalogDetailId) return null
    return PATTERN_CATALOG.find((x) => x.id === catalogDetailId)?.template ?? null
  }, [viewMode, catalogDetailId])

  const catalogStartX = useMemo(() => {
    if (!catalogDemoTemplate) return 0
    return catalogDemoStartX(catalogDemoTemplate.length)
  }, [catalogDemoTemplate])

  const catalogVisibleSlots = useMemo((): CatalogSlot[] => {
    if (!catalogDemoTemplate) return []
    const ordered = catalogStoneSlots(catalogDemoTemplate)
    const n = ordered.length
    const visibleCount =
      catalogAnimFrame === 0 ? 0 : Math.min(catalogAnimFrame, n)
    return ordered.slice(0, visibleCount)
  }, [catalogDemoTemplate, catalogAnimFrame])

  const gameOver = winner !== 0

  useEffect(() => {
    setMounted(true)
  }, [])

  const closeAbout = useCallback(() => {
    if (!aboutVisible || aboutLeaving) return
    if (aboutCloseTimerRef.current) {
      clearTimeout(aboutCloseTimerRef.current)
      aboutCloseTimerRef.current = null
    }
    setAboutLeaving(true)
    aboutCloseTimerRef.current = window.setTimeout(() => {
      aboutCloseTimerRef.current = null
      setAboutVisible(false)
      setAboutLeaving(false)
    }, 380)
  }, [aboutVisible, aboutLeaving])

  useEffect(() => {
    return () => {
      if (aboutCloseTimerRef.current) clearTimeout(aboutCloseTimerRef.current)
    }
  }, [])

  useEffect(() => {
    if (!aboutVisible) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAbout()
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [aboutVisible, closeAbout])

  useEffect(() => {
    if (viewMode !== 'catalog') setCatalogDetailId(null)
  }, [viewMode])

  useEffect(() => {
    if (viewMode !== 'history') {
      setHistoryDeleteMode(false)
      setHistorySelectedIds([])
    }
  }, [viewMode])

  useEffect(() => {
    if (skipFirstViewSwitchAnimRef.current) {
      skipFirstViewSwitchAnimRef.current = false
      return
    }
    setViewSwitchAnim(true)
    const t = window.setTimeout(() => setViewSwitchAnim(false), 460)
    return () => window.clearTimeout(t)
  }, [viewMode])

  useEffect(() => {
    setCatalogAnimFrame(0)
  }, [catalogDetailId])

  useEffect(() => {
    if (viewMode !== 'catalog' || !catalogDetailId) return
    const item = PATTERN_CATALOG.find((x) => x.id === catalogDetailId)
    if (!item) return
    const n = catalogStoneSlots(item.template).length
    if (n === 0) return
    const cycleEnd = 1 + n + 6
    const t = window.setInterval(() => {
      setCatalogAnimFrame((f) => (f >= cycleEnd ? 0 : f + 1))
    }, 360)
    return () => window.clearInterval(t)
  }, [viewMode, catalogDetailId])

  /** 棋盘像素 + 右侧玻璃高度：左侧 board-zone 与 main-top-row 行盒取 max，避免「r 比 h 大很多」时仍用偏小的 h 导致右侧矮一截 */
  const syncSidePanelHeight = () => {
    const vm = viewModeRef.current
    const zone = boardZoneRef.current
    const row = mainTopRowRef.current
    if (!zone) return
    const bMeas = boardMeasureRef.current
    const wEl = boardWrapRef.current
    if (bMeas) {
      const d = Math.min(bMeas.clientWidth, bMeas.clientHeight)
      if (d > 0) setBoardPx(Math.floor(d))
    } else if (wEl) {
      const w = Math.min(wEl.offsetWidth, wEl.offsetHeight)
      const boardEdge = Math.floor(Math.max(0, w - 36))
      setBoardPx(boardEdge > 0 ? boardEdge : 640)
    }
    const zInt = zone.offsetHeight
    const zSub = Math.ceil(zone.getBoundingClientRect().height)
    const r = row ? row.clientHeight : 0
    const wrapH = wEl ? wEl.offsetHeight : 0

    // 人机对弈：勿用整行 clientHeight r，招式板列表会把行撑高，导致右侧玻璃异常长于棋盘
    if (vm === 'play') {
      const zoneH = Math.max(zSub, zInt)
      const zPlay =
        wrapH > 0 && zoneH > wrapH + 80 ? Math.min(zoneH, wrapH + 48) : zoneH
      const h = Math.max(zPlay, wrapH)
      setBoardWrapOuterHeight(Math.max(0, h))
      return
    }

    // 旧逻辑曾写「r <= h + 6 才合并 r」：当栅格行盒已随左侧拉高、而 zone 仍为上一帧较小值时，r>>h，侧栏高度被锁死偏矮（招式大全下尤其明显）
    // board-zone 被滑轨兄弟列撑高时 zInt 会远大于棋盘方块；用 wrapH 约束上沿，避免侧栏被锁成过高
    const zUse =
      wrapH > 0 && zInt > wrapH + 80 ? Math.min(zInt, wrapH + 48) : zInt
    const h = Math.max(zUse, zSub, r, wrapH)
    setBoardWrapOuterHeight(Math.max(0, h))
  }

  // Responsive board size + 与侧栏同高
  useEffect(() => {
    const wrap = boardWrapRef.current
    const zone = boardZoneRef.current
    const row = mainTopRowRef.current
    const boardEl = boardMeasureRef.current
    if (!wrap || !zone) return
    const ro = new ResizeObserver(() => syncSidePanelHeight())
    ro.observe(zone)
    ro.observe(wrap)
    if (boardEl) ro.observe(boardEl)
    if (row) ro.observe(row)
    syncSidePanelHeight()
    return () => ro.disconnect()
  }, [viewMode])

  /** 切换对局 / 历史 / 招式后列宽变化，多帧再量一次避免与棋盘不齐 */
  useLayoutEffect(() => {
    let id2: number | undefined
    const id1 = requestAnimationFrame(() => {
      syncSidePanelHeight()
      id2 = requestAnimationFrame(() => syncSidePanelHeight())
    })
    return () => {
      cancelAnimationFrame(id1)
      if (id2 !== undefined) cancelAnimationFrame(id2)
    }
  }, [viewMode, catalogDetailId])

  // 无对局记录时清空选中，避免沿用旧索引误显示对抗条等
  useEffect(() => {
    if (historyGames.length > 0) return
    setSelectedHistoryIndex(-1)
    setReplayStep(0)
    setReplayPlaying(false)
  }, [historyGames.length])

  // 有记录但未选中：默认最近一局并拉满回放步数，对抗条与分数立即为终局值
  useLayoutEffect(() => {
    if (viewMode !== 'history') return
    if (historyGames.length === 0) return
    if (selectedHistoryIndex >= 0 && selectedHistoryIndex < historyGames.length) return
    const idx = historyGames.length - 1
    const g = historyGames[idx]
    setSelectedHistoryIndex(idx)
    setReplayStep(g.moves.length)
    setReplayPlaying(false)
  }, [viewMode, historyGames, selectedHistoryIndex])

  // 进入「历史查看」时：默认选中一局，棋盘为终局（便于直接看胜负与连线）
  useEffect(() => {
    const entering = viewMode === 'history' && !wasHistoryViewRef.current
    wasHistoryViewRef.current = viewMode === 'history'
    if (viewMode !== 'history') {
      setReplayPlaying(false)
      return
    }
    if (historyGames.length === 0) {
      setSelectedHistoryIndex(-1)
      setReplayStep(0)
      setReplayPlaying(false)
      return
    }

    let idxForFinalReplay: number | null = null
    setSelectedHistoryIndex((prev) => {
      const idx =
        prev >= 0 && prev < historyGames.length ? prev : historyGames.length - 1
      if (entering) idxForFinalReplay = idx
      return idx
    })
    if (entering && idxForFinalReplay !== null) {
      const g = historyGames[idxForFinalReplay]
      setReplayStep(g ? g.moves.length : 0)
      setReplayPlaying(false)
    }
  }, [viewMode, historyGames.length])

  // 历史列表勾选：删除对局后去掉已不存在的 id
  useEffect(() => {
    setHistorySelectedIds((prev) => prev.filter((id) => historyGames.some((g) => g.id === id)))
  }, [historyGames])

  // 播放到最后一手时自动暂停
  useEffect(() => {
    if (viewMode !== 'history' || !replayPlaying) return
    if (replayMoves.length === 0) return
    if (replayStep < replayMoves.length) return
    setReplayPlaying(false)
  }, [viewMode, replayPlaying, replayStep, replayMoves.length])

  // 历史播放：定时推进 replayStep（不依赖 replayStep，避免每步重置定时器）
  useEffect(() => {
    if (viewMode !== 'history') return
    if (!replayPlaying) return
    if (!activeHistory) return
    if (replayMoves.length === 0) return

    const t = window.setInterval(() => {
      setReplayStep((s) => {
        if (s >= replayMoves.length) return s
        return s + 1
      })
    }, 420)

    return () => window.clearInterval(t)
  }, [viewMode, replayPlaying, selectedHistoryIndex, replayMoves.length, activeHistory?.id])

  const allHistorySelected =
    historyGames.length > 0 && historySelectedIds.length === historyGames.length

  const toggleHistorySelect = (id: string) => {
    setHistorySelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const toggleSelectAllHistory = () => {
    setHistorySelectedIds((prev) =>
      prev.length === historyGames.length ? [] : historyGames.map((g) => g.id),
    )
  }

  const cancelHistoryDeleteMode = useCallback(() => {
    setHistoryDeleteMode(false)
    setHistorySelectedIds([])
  }, [])

  const deleteSelectedHistoryGames = () => {
    if (historySelectedIds.length === 0) return
    const curId =
      resolvedHistoryIndex >= 0 ? historyGames[resolvedHistoryIndex]?.id : undefined
    const next = historyGames.filter((g) => !historySelectedIds.includes(g.id))
    setHistoryGames(next)
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
    } catch {
      // localStorage 失败不影响界面
    }
    setHistorySelectedIds([])
    setHistoryDeleteMode(false)
    setReplayPlaying(false)
    if (next.length === 0) {
      setSelectedHistoryIndex(-1)
      setReplayStep(0)
      return
    }
    let newIdx: number
    if (curId && next.some((g) => g.id === curId)) {
      newIdx = next.findIndex((g) => g.id === curId)
    } else {
      newIdx = next.length - 1
    }
    const g = next[newIdx]
    setSelectedHistoryIndex(newIdx)
    setReplayStep(g.moves.length)
  }

  const handleReset = () => {
    setViewMode('play')
    setBoard(createEmptyBoard())
    setCurrentPlayer(1)
    setWinner(0)
    setWinLine([])
    setMoveHistory([])
    setHintTarget(null)
    setFocus(null)
    setReplayStep(0)
    setReplayPlaying(false)
    setSessionId(String(Date.now()))
    savedForSessionRef.current = null
  }

  const handleCellClick = (x: number, y: number) => {
    if (viewMode !== 'play') return
    if (gameOver || currentPlayer !== 1) return
    const idx = indexOf(x, y)
    if (board[idx] !== 0) return

    const nextBoard = board.slice()
    nextBoard[idx] = 1
    const evalMove = evaluateBoardAt(board, x, y, 1)
    const win = checkWin(nextBoard, x, y, 1)
    const uiScoreDelta = Math.round(evalMove.score / 100)

    const move: MoveRecord = {
      index: moveHistory.length + 1,
      x,
      y,
      player: 1,
      scoreDelta: uiScoreDelta,
      pattern: evalMove.pattern || '平稳一手',
    }

    setBoard(nextBoard)
    setMoveHistory((prev) => [...prev, move])
    setHintTarget(null)
    setBoardKick((k) => (k === 0 ? 1 : 0))
    setFocus({ x, y })

    if (win) {
      setWinner(1)
      setWinLine(win.line)
      return
    }
    setCurrentPlayer(2)
  }

  // Easy mode hint: only show the best move (no extra options)
  useEffect(() => {
    if (viewMode !== 'play' || difficulty !== 'easy' || gameOver || currentPlayer !== 1) {
      setHintTarget(null)
      return
    }
    const moves: ScoredMove[] = []
    for (let y = 0; y < BOARD_SIZE; y++) {
      for (let x = 0; x < BOARD_SIZE; x++) {
        const idx = indexOf(x, y)
        if (board[idx] !== 0) continue
        let hasNeighbor = false
        for (let dy = -2; dy <= 2 && !hasNeighbor; dy++) {
          for (let dx = -2; dx <= 2 && !hasNeighbor; dx++) {
            if (dx === 0 && dy === 0) continue
            const nx = x + dx
            const ny = y + dy
            if (inBounds(nx, ny) && board[indexOf(nx, ny)] !== 0) {
              hasNeighbor = true
            }
          }
        }
        if (!hasNeighbor) continue
        moves.push(evaluateBoardAt(board, x, y, 1))
      }
    }
    moves.sort((a, b) => b.score - a.score)
    const best = moves[0]
    setHintTarget(best ? { x: best.x, y: best.y } : null)
  }, [board, currentPlayer, difficulty, gameOver])

  // AI move when it's AI's turn
  useEffect(() => {
    if (viewMode !== 'play' || gameOver || currentPlayer !== 2) return
    const aiMove = chooseAIMove(board, difficulty)
    if (!aiMove) return
    const idx = indexOf(aiMove.x, aiMove.y)
    const nextBoard = board.slice()
    nextBoard[idx] = 2
    const win = checkWin(nextBoard, aiMove.x, aiMove.y, 2)
    // 与玩家落子一致：终局一手用 evaluateBoardAt 计分（chooseAIMove 对「立即成五」会设 1e12，仅用于选点）
    const evalForUi = evaluateBoardAt(board, aiMove.x, aiMove.y, 2)
    const uiScoreDelta = win
      ? Math.round(evalForUi.score / 100)
      : Math.round(aiMove.score / 100)

    const move: MoveRecord = {
      index: moveHistory.length + 1,
      x: aiMove.x,
      y: aiMove.y,
      player: 2,
      scoreDelta: uiScoreDelta,
      pattern: win ? evalForUi.pattern || '立即成五' : aiMove.pattern || '稳健应对',
    }

    setTimeout(() => {
      setBoard(nextBoard)
      setMoveHistory((prev) => [...prev, move])
      setBoardKick((k) => (k === 0 ? 1 : 0))
      setFocus({ x: aiMove.x, y: aiMove.y })
      if (win) {
        setWinner(2)
        setWinLine(win.line)
      } else {
        setCurrentPlayer(1)
      }
    }, 350)
  }, [board, currentPlayer, difficulty, gameOver, moveHistory.length])

  // Winner flash: big white text fade in/out
  useEffect(() => {
    if (viewMode !== 'play') return
    if (winner === 0) return
    const text = winner === 1 ? '您赢了' : '您输了'
    setResultFlash({ text, show: true })
    const t1 = window.setTimeout(() => setResultFlash({ text, show: false }), 1400)
    const t2 = window.setTimeout(() => setResultFlash(null), 2100)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [winner])

  // 结束后：将本局写入历史（用于历史查看回放）
  useEffect(() => {
    if (viewMode !== 'play') return
    if (winner === 0) return
    if (savedForSessionRef.current === sessionId) return
    if (!moveHistory.length) return

    const game: HistoryGame = {
      id: sessionId,
      createdAt: Date.now(),
      difficulty,
      moves: moveHistory,
      winner,
      winLine,
      totalScore,
    }

    setHistoryGames((prev) => {
      const next = [game, ...prev.filter((g) => g.id !== sessionId)].slice(0, 30)
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
      } catch {
        // localStorage 失败不影响游戏本身
      }
      return next
    })
    savedForSessionRef.current = sessionId
  }, [winner, viewMode, sessionId, difficulty, moveHistory, winLine])

  const currentStatus = useMemo(() => {
    if (winner === 1) return '你赢了（黑方）'
    if (winner === 2) return 'AI 赢了（白方）'
    return currentPlayer === 1 ? '轮到你（黑子）' : 'AI 思考中…'
  }, [winner, currentPlayer])

  const viewModeSlideSlot = viewMode === 'play' ? '0' : viewMode === 'history' ? '1' : '2'

  /** 三列工作台各自棋盘/连线（与底栏滑轨同步横向滑动） */
  const getColumnDerived = (mode: ViewMode) => {
    if (mode === 'play') {
      const colDisplayWinLine: [number, number][] =
        winner === 0
          ? []
          : winLine.length >= 2
            ? winLine
            : findWinningLineFromBoard(board, winner) ?? []
      return {
        colBoard: board,
        colWinner: winner,
        colDisplayWinLine,
        colActiveMoves: moveHistory,
        colFocusEffective: focus,
        colActiveGameOver: winner !== 0,
        histMoves: undefined as MoveRecord[] | undefined,
        histStep: undefined as number | undefined,
        histDuelScores: undefined as { you: number; ai: number } | undefined,
        histGame: undefined as HistoryGame | null | undefined,
      }
    }
    if (mode === 'history') {
      const fallbackGame =
        resolvedHistoryIndex >= 0 && resolvedHistoryIndex < historyGames.length
          ? historyGames[resolvedHistoryIndex]
          : historyGames.length > 0
            ? historyGames[historyGames.length - 1]
            : null
      const g =
        historyGames.length === 0
          ? null
          : viewMode === 'history'
            ? (activeHistory ?? fallbackGame)
            : fallbackGame
      const moves = g?.moves ?? []
      const step = viewMode === 'history' ? replayStep : moves.length
      const colBoard = boardFromMoves(moves, step)
      const rw = g?.winner ?? 0
      let colDisplayWinLine: [number, number][] = []
      if (rw !== 0 && step >= moves.length) {
        if (g && g.winLine.length >= 2) colDisplayWinLine = g.winLine
        else if (g) {
          const fb = boardFromMoves(moves, moves.length)
          colDisplayWinLine = findWinningLineFromBoard(fb, rw) ?? []
        }
      }
      if (step < moves.length) colDisplayWinLine = []
      const colActiveMoves = moves.slice(0, step)
      const colFocusEffective =
        colActiveMoves.length > 0
          ? {
              x: colActiveMoves[colActiveMoves.length - 1].x,
              y: colActiveMoves[colActiveMoves.length - 1].y,
            }
          : null
      return {
        colBoard,
        colWinner: rw,
        colDisplayWinLine,
        colActiveMoves,
        colFocusEffective,
        colActiveGameOver: rw !== 0,
        histMoves: moves,
        histStep: step,
        histDuelScores: scoresFromMoves(moves.slice(0, step)),
        histGame: g,
      }
    }
    return {
      colBoard: board,
      colWinner: 0 as Player | 0,
      colDisplayWinLine: [] as [number, number][],
      colActiveMoves: moveHistory,
      colFocusEffective:
        viewMode === 'catalog' && catalogVisibleSlots.length > 0
          ? catalogVisibleSlots[catalogVisibleSlots.length - 1]
          : null,
      colActiveGameOver: false,
      histMoves: undefined as MoveRecord[] | undefined,
      histStep: undefined as number | undefined,
      histDuelScores: undefined as { you: number; ai: number } | undefined,
      histGame: undefined as HistoryGame | null | undefined,
    }
  }

  return (
    <div className={`app-root ${mounted ? 'app-mounted' : ''}`}>
      <div className="bg-orbit" />

      <div className="app-shell">
      <header className="top-bar">
        <div className="brand">
          <div className="brand-orb" aria-hidden="true">
            <span className="brand-mark" />
          </div>
          <div className="brand-text">
            <div className="brand-title">五子棋</div>
          </div>
        </div>
        <div className="top-controls">
          <div className="pill-toggle">
            <button
              className={`pill ${viewMode === 'play' ? 'active' : ''}`}
              onClick={() => setViewMode('play')}
            >
              人机对弈
            </button>
            <button
              className={`pill ${viewMode === 'history' ? 'active' : ''}`}
              onClick={() => setViewMode('history')}
            >
              历史查看
            </button>
            <button
              className={`pill ${viewMode === 'catalog' ? 'active' : ''}`}
              onClick={() => setViewMode('catalog')}
            >
              招式大全
            </button>
          </div>
          <div className="difficulty">
            <span className="difficulty-label">难度</span>
            <div
              className="difficulty-glass"
              data-difficulty={difficulty}
              role="group"
              aria-label="对局难度"
            >
              <div className="difficulty-glass-sheen" aria-hidden="true" />
              <div className="difficulty-glass-thumb" aria-hidden="true" />
              <div className="difficulty-glass-row">
                <button
                  type="button"
                  className={`difficulty-opt ${difficulty === 'easy' ? 'difficulty-opt--active' : ''}`}
                  onClick={() => {
                    setDifficulty('easy')
                    handleReset()
                  }}
                  aria-pressed={difficulty === 'easy'}
                >
                  简单
                </button>
                <button
                  type="button"
                  className={`difficulty-opt ${difficulty === 'normal' ? 'difficulty-opt--active' : ''}`}
                  onClick={() => {
                    setDifficulty('normal')
                    handleReset()
                  }}
                  aria-pressed={difficulty === 'normal'}
                >
                  普通
                </button>
                <button
                  type="button"
                  className={`difficulty-opt ${difficulty === 'hard' ? 'difficulty-opt--active' : ''}`}
                  onClick={() => {
                    setDifficulty('hard')
                    handleReset()
                  }}
                  aria-pressed={difficulty === 'hard'}
                >
                  困难
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={`about-info-btn ${aboutBtnPulse ? 'about-info-btn--pulse' : ''}`}
            onClick={() => {
              setAboutBtnPulse(true)
              if (aboutCloseTimerRef.current) {
                clearTimeout(aboutCloseTimerRef.current)
                aboutCloseTimerRef.current = null
              }
              setAboutLeaving(false)
              setAboutVisible(true)
              window.setTimeout(() => setAboutBtnPulse(false), 520)
            }}
            aria-label="关于本作"
            title="关于本作"
          >
            <span className="about-info-icon" aria-hidden="true">
              i
            </span>
          </button>
        </div>
      </header>

      <main
        className={`main-layout ${
          viewMode === 'history'
            ? 'view-history'
            : viewMode === 'catalog'
              ? 'view-catalog'
              : 'view-play'
        } ${viewSwitchAnim ? 'main-layout--view-switch' : ''}`}
      >
        {/* 横向滑轨：裁切只放在 view-mode-track-clip 上，勿给本壳固定 height+overflow，否则会切掉棋盘/侧栏底部圆角 */}
        <div className="view-mode-main-shell view-mode-footer-shell">
          <div className="view-mode-track-clip">
          <div className="view-mode-footer-track" data-slot={viewModeSlideSlot}>
            {(['play', 'history', 'catalog'] as const).map((colMode) => {
              const d = getColumnDerived(colMode)
              return (
                <div
                  key={colMode}
                  className={`view-mode-footer-panel${
                    viewMode === colMode ? ' view-mode-footer-panel--active' : ''
                  }`}
                  aria-hidden={viewMode !== colMode}
                >
                  <div
                    className="main-top-row"
                    ref={(el) => {
                      if (colMode === viewMode) mainTopRowRef.current = el
                    }}
                  >
                    <section
                      ref={(el) => {
                        if (colMode === viewMode) boardZoneRef.current = el
                      }}
                      className={`board-zone ${
                        colMode === 'catalog' && catalogDetailId ? 'board-zone--catalog-demo' : ''
                      } ${colMode === 'catalog' ? 'board-zone--catalog-row' : ''} ${
                        colMode === 'play' || colMode === 'history' ? 'board-zone--board-only-row' : ''
                      }`}
                    >
                      <div
                        className="board-wrap"
                        ref={(el) => {
                          if (colMode === viewMode) boardWrapRef.current = el
                        }}
                      >
            <div className="board-container">
              <div className="board-shadow" />
              <div
                className="board"
                ref={(el) => {
                  if (colMode === viewMode) boardMeasureRef.current = el
                }}
                style={{
                  ['--boardPx' as never]: `${boardPx}px`,
                  ['--focusX' as never]: d.colFocusEffective
                    ? `${(d.colFocusEffective.x / (BOARD_SIZE - 1)) * 100}%`
                    : '50%',
                  ['--focusY' as never]: d.colFocusEffective
                    ? `${(d.colFocusEffective.y / (BOARD_SIZE - 1)) * 100}%`
                    : '50%',
                }}
              >
                <div className={`board-kick-shell board-kick-${boardKick}`}>
                <div className="board-sheen" aria-hidden="true" />
                <div className="board-grid" aria-hidden="true" />
                <div className="board-focus" aria-hidden="true" />
                <div className="board-vignette" aria-hidden="true" />

                {(() => {
                  if (colMode === 'catalog' && catalogDetailId) {
                    if (catalogVisibleSlots.length < 2) return null
                    const inset = 18
                    const inner = Math.max(0, boardPx - inset * 2)
                    const cellPx = inner / (BOARD_SIZE - 1)
                    const a = catalogVisibleSlots[0]
                    const b = catalogVisibleSlots[catalogVisibleSlots.length - 1]
                    const sx = inset + a.x * cellPx
                    const sy = inset + a.y * cellPx
                    const ex = inset + b.x * cellPx
                    const ey = inset + b.y * cellPx
                    return (
                      <svg
                        className="win-line-svg catalog-win-line"
                        width={boardPx}
                        height={boardPx}
                        viewBox={`0 0 ${boardPx} ${boardPx}`}
                        preserveAspectRatio="none"
                        aria-hidden="true"
                      >
                        <defs>
                          <linearGradient
                            id={`catalogWinGrad-${catalogLineGradId}`}
                            x1="0"
                            y1="0"
                            x2="1"
                            y2="0"
                          >
                            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.95" />
                            <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.95" />
                            <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.95" />
                          </linearGradient>
                        </defs>
                        <line
                          x1={sx}
                          y1={sy}
                          x2={ex}
                          y2={ey}
                          stroke={`url(#catalogWinGrad-${catalogLineGradId})`}
                          strokeWidth="7"
                          strokeLinecap="round"
                          opacity="0.95"
                        />
                        <line
                          x1={sx}
                          y1={sy}
                          x2={ex}
                          y2={ey}
                          stroke={`url(#catalogWinGrad-${catalogLineGradId})`}
                          strokeWidth="20"
                          strokeLinecap="round"
                          opacity="0.2"
                          className="catalog-line-glow"
                        />
                      </svg>
                    )
                  }
                  if (d.colWinner === 0 || d.colDisplayWinLine.length < 2) return null
                  const inset = 18
                  const inner = Math.max(0, boardPx - inset * 2)
                  const cellPx = inner / (BOARD_SIZE - 1)
                  if (colMode === 'history' && viewMode === 'history' && replayStep < replayMoves.length)
                    return null
                  const sx = inset + d.colDisplayWinLine[0][0] * cellPx
                  const sy = inset + d.colDisplayWinLine[0][1] * cellPx
                  const ex = inset + d.colDisplayWinLine[d.colDisplayWinLine.length - 1][0] * cellPx
                  const ey = inset + d.colDisplayWinLine[d.colDisplayWinLine.length - 1][1] * cellPx
                  return (
                    <svg
                      className="win-line-svg"
                      width={boardPx}
                      height={boardPx}
                      viewBox={`0 0 ${boardPx} ${boardPx}`}
                      preserveAspectRatio="none"
                      aria-hidden="true"
                    >
                      <defs>
                        <linearGradient id="winGrad" x1="0" y1="0" x2="1" y2="1">
                          <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.95" />
                          <stop offset="55%" stopColor="#8b5cf6" stopOpacity="0.95" />
                          <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.95" />
                        </linearGradient>
                      </defs>
                      <line
                        x1={sx}
                        y1={sy}
                        x2={ex}
                        y2={ey}
                        stroke="url(#winGrad)"
                        strokeWidth="7"
                        strokeLinecap="round"
                        opacity="0.95"
                      />
                      <line
                        x1={sx}
                        y1={sy}
                        x2={ex}
                        y2={ey}
                        stroke="url(#winGrad)"
                        strokeWidth="18"
                        strokeLinecap="round"
                        opacity="0.16"
                        className="win-line-glow"
                      />
                    </svg>
                  )
                })()}

                {Array.from({ length: BOARD_SIZE }).map((_, y) =>
                  Array.from({ length: BOARD_SIZE }).map((__, x) => {
                    const idx = indexOf(x, y)
                    let cell = d.colBoard[idx]
                    const inCatalogBand =
                      colMode === 'catalog' &&
                      catalogDetailId &&
                      catalogDemoTemplate &&
                      y === CATALOG_DEMO_Y &&
                      x >= catalogStartX &&
                      x < catalogStartX + catalogDemoTemplate.length

                    if (inCatalogBand && catalogDemoTemplate) {
                      const i = x - catalogStartX
                      if (catalogDemoTemplate[i] === 0) {
                        cell = 0
                      } else {
                        const ordered = catalogStoneSlots(catalogDemoTemplate)
                        const n = ordered.length
                        const visibleCount =
                          catalogAnimFrame === 0 ? 0 : Math.min(catalogAnimFrame, n)
                        const k = ordered.findIndex((s) => s.x === x && s.y === y)
                        cell =
                          k >= 0 && k < visibleCount ? ordered[k].player : 0
                      }
                    }

                    const isCatalogStone =
                      colMode === 'catalog' &&
                      catalogDetailId &&
                      catalogVisibleSlots.some((s) => s.x === x && s.y === y)
                    const isOnWinLine =
                      colMode === 'catalog' && catalogDetailId
                        ? isCatalogStone
                        : d.colDisplayWinLine.some(([xx, yy]) => xx === x && yy === y)
                    const isHint =
                      colMode === 'play' &&
                      viewMode === 'play' &&
                      !gameOver &&
                      difficulty === 'easy' &&
                      currentPlayer === 1 &&
                      hintTarget?.x === x &&
                      hintTarget?.y === y
                    const isLast =
                      colMode === 'catalog' && catalogDetailId
                        ? catalogVisibleSlots.length > 0 &&
                          catalogVisibleSlots[catalogVisibleSlots.length - 1].x === x &&
                          catalogVisibleSlots[catalogVisibleSlots.length - 1].y === y
                        : d.colActiveMoves.length > 0 &&
                          d.colActiveMoves[d.colActiveMoves.length - 1].x === x &&
                          d.colActiveMoves[d.colActiveMoves.length - 1].y === y

                    const inset = 18
                    const inner = Math.max(0, boardPx - inset * 2)
                    const cellPx = inner / (BOARD_SIZE - 1)
                    const left = inset + x * cellPx
                    const top = inset + y * cellPx

                    return (
                      <button
                        key={`${x}-${y}`}
                        className={`pt ${isOnWinLine ? 'pt-win' : ''} ${isHint ? 'pt-hint' : ''}`}
                        style={{ left, top }}
                        onClick={() => handleCellClick(x, y)}
                        disabled={colMode !== 'play' || colMode !== viewMode}
                        aria-label={`落子 (${x + 1}, ${y + 1})`}
                      >
                        <span className="pt-cross" aria-hidden="true" />
                        {cell !== 0 && (
                          <span
                            className={`stone stone-${cell === 1 ? 'black' : 'white'} ${
                              isLast ? 'stone-last' : ''
                            }                             ${
                              colMode === 'catalog' &&
                              catalogDetailId &&
                              isLast
                                ? 'stone-catalog'
                                : ''
                            }`}
                            aria-hidden="true"
                          />
                        )}
                      </button>
                    )
                  }),
                )}
                </div>
              </div>
            </div>
          </div>
        </section>

        <aside
          className="side-panel"
          style={
            boardWrapOuterHeight > 0
              ? {
                  height: boardWrapOuterHeight,
                  minHeight: boardWrapOuterHeight,
                  boxSizing: 'border-box',
                }
              : undefined
          }
        >
          <div className="side-panel-surface glass">
          {colMode === 'play' && (
            <div className="play-side">
              <header className="play-side-header">
                <div className="play-side-title">人机对弈</div>
                <div className="play-side-difficulty-row">
                  <span className="play-side-difficulty-label">难度</span>
                  <span
                    className={`play-side-difficulty-badge play-side-difficulty-badge--${difficulty}`}
                  >
                    {difficulty === 'easy'
                      ? '简单'
                      : difficulty === 'normal'
                        ? '普通'
                        : '困难'}
                  </span>
                </div>
                <p className="play-side-desc">
                  {difficulty === 'easy'
                    ? '简单模式下关键好棋会被记分并命名招式'
                    : '当前难度下仅记录招式与分数，不提供提示光'}
                </p>
              </header>
              <div className="panel-section play-side-moves">
              <div className="panel-title panel-title--moves">招式板 / 本局走势</div>
              <div className="moves-list">
                {moveHistory.length === 0 ? (
                  <div className="empty">等待你的第一手棋…</div>
                ) : (
                  moveHistory
                    .slice()
                    .reverse()
                    .map((m) => (
                      <div
                        key={m.index}
                        className={`move-row ${m.index === moveHistory.length ? 'move-row-new' : ''}`}
                      >
                        <div className="move-meta">
                          <span
                            className={`badge badge-${m.player === 1 ? 'black' : 'white'}`}
                          >
                            {m.player === 1 ? '你' : 'AI'}
                          </span>
                          <span className="move-coord">
                            第 {m.index} 手 · ({m.x + 1}, {m.y + 1})
                          </span>
                        </div>
                        <div className="move-detail">
                          <span className="move-pattern">{m.pattern}</span>
                          {m.scoreDelta !== 0 && (
                            <span
                              className={`move-score ${
                                m.scoreDelta > 0 ? 'pos' : 'neg'
                              }`}
                            >
                              {m.scoreDelta > 0 ? '+' : ''}
                              {m.scoreDelta}
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                )}
              </div>
              </div>
            </div>
          )}
          {colMode === 'history' && (
            <div
              className={`panel-section history-only ${
                historyDeleteMode ? 'history-only--delete-mode' : ''
              }`}
            >
              <div className="history-header-row">
                <div className="history-header-text">
                  <div className="panel-title">历史查看</div>
                  <div className="panel-sub">选择一局并回放棋谱</div>
                </div>
                {historyGames.length > 0 && (
                  <button
                    type="button"
                    className="history-delete-mode-btn"
                    onClick={() =>
                      historyDeleteMode
                        ? cancelHistoryDeleteMode()
                        : setHistoryDeleteMode(true)
                    }
                  >
                    {historyDeleteMode ? '取消删除' : '删除记录'}
                  </button>
                )}
              </div>

              <div
                className={`history-toolbar-slot ${
                  historyDeleteMode && historyGames.length > 0
                    ? 'history-toolbar-slot--open'
                    : ''
                }`}
              >
                <div className="history-toolbar-slot-inner">
                  <div className="history-toolbar">
                    <label className="history-toolbar-all">
                      <input
                        type="checkbox"
                        checked={allHistorySelected}
                        onChange={toggleSelectAllHistory}
                        aria-label="全选历史记录"
                      />
                      <span>全选</span>
                    </label>
                    <button
                      type="button"
                      className="pill history-delete-btn"
                      disabled={historySelectedIds.length === 0}
                      onClick={deleteSelectedHistoryGames}
                    >
                      删除所选
                    </button>
                  </div>
                </div>
              </div>

              <div className="history-list">
                {historyGames.length === 0 ? (
                  <div className="empty">
                    暂无历史对局（完成一局后会自动保存）
                  </div>
                ) : (
                  historyGames
                    .slice()
                    .reverse()
                    .map((g, revIdx) => {
                      const realIdx = historyGames.length - 1 - revIdx
                      const selected = realIdx === resolvedHistoryIndex
                      const checked = historySelectedIds.includes(g.id)
                      const resultClass =
                        g.winner === 1
                          ? 'history-result--win'
                          : g.winner === 2
                            ? 'history-result--lose'
                            : 'history-result--draw'
                      const endScores = scoresFromMoves(g.moves)
                      return (
                        <div
                          key={g.id}
                          className={`history-card-row ${
                            selected ? 'history-card-row-selected' : ''
                          }`}
                        >
                          <div
                            className={`history-card-cb-shell ${
                              historyDeleteMode ? 'history-card-cb-shell--on' : ''
                            }`}
                            aria-hidden={!historyDeleteMode}
                          >
                            {historyDeleteMode ? (
                              <input
                                type="checkbox"
                                className="history-card-cb"
                                checked={checked}
                                onChange={() => toggleHistorySelect(g.id)}
                                aria-label={`选择记录 ${new Date(g.createdAt).toLocaleString()}`}
                                onClick={(e) => e.stopPropagation()}
                              />
                            ) : null}
                          </div>
                          <button
                            type="button"
                            className={`history-card ${
                              selected ? 'history-card-selected' : ''
                            }`}
                            onClick={() => {
                              setSelectedHistoryIndex(realIdx)
                              setReplayStep(g.moves.length)
                              setReplayPlaying(false)
                            }}
                          >
                            <div className="history-card-top">
                              <span className="history-time">
                                {new Date(g.createdAt).toLocaleString()}
                              </span>
                              <span className={`history-result ${resultClass}`}>
                                {g.winner === 1
                                  ? '您赢了'
                                  : g.winner === 2
                                    ? '您输了'
                                    : '和局'}
                              </span>
                            </div>
                            <div className="history-card-sub">
                              难度：{g.difficulty} · 手数：{g.moves.length} · 你{' '}
                              {endScores.you} · AI {endScores.ai}
                            </div>
                          </button>
                        </div>
                      )
                    })
                )}
              </div>

              <div className="history-bottom-stack">
              <div className="replay-controls">
                <div className="replay-row">
                  <button
                    className="pill"
                    onClick={() => setReplayStep((s) => Math.max(0, s - 1))}
                    disabled={!activeHistory || replayStep <= 0}
                  >
                    ←
                  </button>
                  <button
                    className="pill active"
                    type="button"
                    onClick={() => {
                      if (!activeHistory || replayMoves.length === 0) return
                      if (replayStep >= replayMoves.length) {
                        setReplayStep(0)
                        setReplayPlaying(true)
                        return
                      }
                      setReplayPlaying((v) => !v)
                    }}
                    disabled={!activeHistory || replayMoves.length === 0}
                  >
                    {replayPlaying
                      ? '暂停'
                      : replayStep >= replayMoves.length && replayMoves.length > 0
                        ? '重播'
                        : '播放'}
                  </button>
                  <button
                    className="pill"
                    onClick={() =>
                      setReplayStep((s) =>
                        Math.min(replayMoves.length, s + 1),
                      )
                    }
                    disabled={
                      !activeHistory || replayStep >= replayMoves.length
                    }
                  >
                    →
                  </button>
                </div>

                <div className="replay-slider">
                  <input
                    type="range"
                    min={0}
                    max={replayMoves.length}
                    step={1}
                    value={replayStep}
                    onChange={(e) => setReplayStep(Number(e.target.value))}
                    disabled={!activeHistory}
                  />
                  <div className="replay-meta">
                    第 {replayStep} 手 / 共 {replayMoves.length} 手
                  </div>
                </div>
              </div>

              {d.histGame && (
                <div className="history-duel-bar">
                  <div className="history-duel-bar__head">
                    <span
                      className={`history-duel-bar__tag ${
                        d.histGame!.winner === 1
                          ? 'history-duel-bar__tag--win'
                          : d.histGame!.winner === 2
                            ? 'history-duel-bar__tag--dim'
                            : ''
                      }`}
                    >
                      你
                    </span>
                    <span className="history-duel-bar__vs">VS</span>
                    <span
                      className={`history-duel-bar__tag ${
                        d.histGame!.winner === 2
                          ? 'history-duel-bar__tag--lose'
                          : d.histGame!.winner === 1
                            ? 'history-duel-bar__tag--dim'
                            : ''
                      }`}
                    >
                      AI
                    </span>
                  </div>
                  <div className="history-duel-bar__track" aria-hidden="true">
                    {(() => {
                      const ds = d.histDuelScores ?? { you: 0, ai: 0 }
                      const sum = ds.you + ds.ai
                      const pctYou = sum > 0 ? (ds.you / sum) * 100 : 50
                      return (
                        <>
                          <div
                            className="history-duel-bar__meter history-duel-bar__meter--you"
                            style={{ width: `${pctYou}%` }}
                          />
                          <div
                            className="history-duel-bar__meter history-duel-bar__meter--ai"
                            style={{ width: `${100 - pctYou}%` }}
                          />
                        </>
                      )
                    })()}
                  </div>
                  <div className="history-duel-bar__meta">
                    <div className="history-duel-bar__score-line">
                      <span className="history-duel-bar__score-group">
                        <span className="history-duel-bar__score-label">你</span>{' '}
                        <span className="history-duel-bar__score-num history-duel-bar__score-num--you">
                          {(d.histDuelScores ?? { you: 0, ai: 0 }).you}
                        </span>
                      </span>
                      <span className="history-duel-bar__score-vs-text">vs</span>
                      <span className="history-duel-bar__score-group">
                        <span className="history-duel-bar__score-label">AI</span>{' '}
                        <span className="history-duel-bar__score-num history-duel-bar__score-num--ai">
                          {(d.histDuelScores ?? { you: 0, ai: 0 }).ai}
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              )}
              </div>
            </div>
          )}
          {colMode === 'catalog' && (
            <div className="panel-section catalog-only">
              <div className="catalog-split">
                <div className="catalog-cards-col">
                  <div className="panel-title">招式大全</div>
                  <div className="panel-sub">
                    含单方棋形、对方威胁与双方交手；点选后棋盘逐步演示，右侧为说明
                  </div>
                  <div className="catalog-list catalog-list-scroll">
                    {PATTERN_CATALOG.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`move-card ${
                          catalogDetailId === p.id ? 'move-card-selected' : ''
                        }`}
                        onClick={() =>
                          setCatalogDetailId((id) => (id === p.id ? null : p.id))
                        }
                        aria-label={`查看招式：${p.name}`}
                        aria-pressed={catalogDetailId === p.id}
                      >
                        <div className="move-card-top">
                          <PatternPreview template={p.template} />
                        </div>
                        <div className="move-card-name">{p.name}</div>
                        <div className="move-card-score">分数：+{p.scoreShow}</div>
                      </button>
                    ))}
                  </div>
                </div>
                <div
                  className={`catalog-detail-pane ${catalogDetailId ? 'catalog-detail-pane--open' : ''}`}
                  aria-live="polite"
                >
                  {(() => {
                    const p = catalogDetailId
                      ? PATTERN_CATALOG.find((x) => x.id === catalogDetailId)
                      : null
                    if (!p) {
                      return (
                        <div className="catalog-detail-empty">
                          点选左侧招式卡片，这里显示名称、分数与说明；棋盘上同步播放落子与连线动画。
                        </div>
                      )
                    }
                    return (
                      <div className="catalog-detail-inner">
                        <div className="catalog-detail-head">
                          <div className="catalog-detail-title">{p.name}</div>
                          <div className="catalog-detail-meta">
                            {p.kind} · 分数 +{p.scoreShow}
                          </div>
                        </div>
                        <p className="catalog-detail-desc">{p.description}</p>
                        <button
                          type="button"
                          className="pill catalog-detail-dismiss"
                          onClick={() => setCatalogDetailId(null)}
                        >
                          收起说明
                        </button>
                      </div>
                    )
                  })()}
                </div>
              </div>
            </div>
          )}
          </div>
        </aside>
                  </div>
                </div>
              )
            })}
          </div>
          </div>
        </div>

        <div className="view-mode-footer-shell">
          <div className="view-mode-footer-track" data-slot={viewModeSlideSlot}>
            <div
              className={`view-mode-footer-panel${
                viewMode === 'play' ? ' view-mode-footer-panel--active' : ''
              }`}
              aria-hidden={viewMode !== 'play'}
            >
              <div className="status-strip status-strip--under-board">
                <div className="status-main">{currentStatus}</div>
                <div className="status-secondary">
                  总评分：<span className="score">{totalScore}</span>
                </div>
                <button
                  className={`pill reset-btn ${winner !== 0 ? 'reset-breathe' : ''}`}
                  onClick={handleReset}
                >
                  重新开局
                </button>
              </div>
            </div>
            <div
              className={`view-mode-footer-panel${
                viewMode === 'history' ? ' view-mode-footer-panel--active' : ''
              }`}
              aria-hidden={viewMode !== 'history'}
            >
              <div className="status-strip status-strip--under-board">
                <div className="status-main">
                  {activeHistory
                    ? `历史回放：第 ${replayStep} 手 / 共 ${replayMoves.length} 手`
                    : '历史回放'}
                </div>
                <div className="status-secondary">
                  {activeHistory ? (
                    <>
                      胜负：{activeHistory.winner === 1 ? '您赢了' : activeHistory.winner === 2 ? '您输了' : '和局'} · 难度：
                      <span className="score">{activeHistory.difficulty}</span>
                      {' '}
                      · 你 <span className="score">{duelScores.you}</span> · AI{' '}
                      <span className="score">{duelScores.ai}</span>
                    </>
                  ) : (
                    <>—</>
                  )}
                </div>
                <button className="pill reset-btn" onClick={() => setViewMode('play')}>
                  返回对局
                </button>
              </div>
            </div>
            <div
              className={`view-mode-footer-panel${
                viewMode === 'catalog' ? ' view-mode-footer-panel--active' : ''
              }`}
              aria-hidden={viewMode !== 'catalog'}
            >
              <div className="status-strip status-strip--catalog-under-board">
                <div className="status-main">招式大全 · 查阅各招式的含义与演示</div>
                <div className="status-secondary">
                  选中招式后，棋盘上循环演示落子与连线；右侧为说明
                </div>
                <button className="pill reset-btn" onClick={() => setViewMode('play')}>
                  返回对局
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
      </div>

      {/* 胜负大字闪现 */}
      {resultFlash && viewMode === 'play' && (
        <div className={`result-flash ${resultFlash.show ? 'show' : 'hide'}`}>
          <div className="result-text">{resultFlash.text}</div>
        </div>
      )}

      {aboutVisible && (
        <div
          className={`about-modal-root ${aboutLeaving ? 'about-modal-root--leave' : ''}`}
          role="presentation"
          onClick={closeAbout}
        >
          <div
            className={`about-modal-card ${
              aboutLeaving ? 'about-modal-card--leave' : 'about-modal-card--enter'
            }`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="about-modal-close"
              onClick={closeAbout}
              aria-label="关闭"
            >
              ×
            </button>
            <h2 id="about-modal-title" className="about-modal-title">
              关于本作
            </h2>
            <div className="about-modal-body">
              <h3 className="about-modal-subtitle">创作想法</h3>
              <p className="about-modal-text">
                希望用浏览器实现一套偏「Liquid Glass」质感的五子棋界面：深色背景上的磨砂玻璃、柔光与清晰的操作区，让人机对弈、历史回放与招式导读集中在同一块画布中。在规则简明的前提下，将棋形识别、多档难度与棋谱复习做成顺手的单页体验，并作为练习现代 CSS 与 React 状态管理的一次实践。
              </p>
              <dl className="about-meta">
                <div className="about-meta-row">
                  <dt>创作时间</dt>
                  <dd>2026年4月11日</dd>
                </div>
                <div className="about-meta-row">
                  <dt>创作人</dt>
                  <dd>石天宇</dd>
                </div>
                <div className="about-meta-row">
                  <dt>创作工具</dt>
                  <dd>DeepSeek、Cursor</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
