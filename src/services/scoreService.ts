
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { getDb } from '../lib/firebase';

export interface ScoreRecord {
  name: string;
  score: number;
  mode: string;
  target: number;
  date: string;
  createdAt?: any;
}

const COLLECTION_NAME = 'leaderboard';

export const ScoreService = {
  getDb() {
    return getDb();
  },

  async saveScore(record: Omit<ScoreRecord, 'createdAt'>): Promise<boolean> {
    try {
      const db = await getDb();
      
      // Before saving, verify if it qualifies for Top 10 of its mode
      const currentTop = await this.getTopScores(10, record.mode);
      const isTop10 = currentTop.length < 10 || record.score > (currentTop[currentTop.length - 1]?.score || 0);

      if (!db) {
        if (isTop10) {
          this.saveScoreToLocal(record);
          return true;
        }
        return false;
      }

      if (isTop10) {
        await addDoc(collection(db, COLLECTION_NAME), {
          ...record,
          createdAt: serverTimestamp(),
        });
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error saving score to Firebase:', error);
      // Fallback local
      this.saveScoreToLocal(record);
      return true;
    }
  },

  async getTopScores(count: number = 10, mode?: string): Promise<ScoreRecord[]> {
    try {
      const db = await getDb();
      if (!db) {
        return this.getScoresFromLocal(count, mode);
      }

      let q;
      if (mode) {
        q = query(
          collection(db, COLLECTION_NAME),
          where('mode', '==', mode),
          orderBy('score', 'desc'),
          limit(count)
        );
      } else {
        q = query(
          collection(db, COLLECTION_NAME),
          orderBy('score', 'desc'),
          limit(count)
        );
      }

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
          const data = doc.data() as any;
          return {
              ...data,
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt
          } as ScoreRecord;
      });
    } catch (error) {
      console.error('Error fetching scores from Firebase, falling back to local:', error);
      return this.getScoresFromLocal(count, mode);
    }
  },

  saveScoreToLocal(record: Omit<ScoreRecord, 'createdAt'>) {
    const saved = localStorage.getItem('mathZumaLeaderboard');
    let leaderboard: ScoreRecord[] = saved ? JSON.parse(saved) : [];
    leaderboard.push(record);
    leaderboard.sort((a, b) => b.score - a.score);
    leaderboard = leaderboard.slice(0, 100); // Keep more locally
    localStorage.setItem('mathZumaLeaderboard', JSON.stringify(leaderboard));
  },

  getScoresFromLocal(count: number = 10, mode?: string): ScoreRecord[] {
    const saved = localStorage.getItem('mathZumaLeaderboard');
    if (!saved) return [];
    try {
      let records = JSON.parse(saved) as ScoreRecord[];
      if (mode) {
        records = records.filter(r => r.mode === mode);
      }
      return records.slice(0, count);
    } catch (e) {
      return [];
    }
  }
};
