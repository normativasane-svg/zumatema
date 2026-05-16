
import { collection, addDoc, getDocs, query, orderBy, limit, serverTimestamp, Timestamp } from 'firebase/firestore';
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
  async saveScore(record: Omit<ScoreRecord, 'createdAt'>): Promise<boolean> {
    try {
      const db = await getDb();
      
      // Before saving, verify if it qualifies for Top 10
      const currentTop = await this.getTopScores(10);
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

  async getTopScores(count: number = 10): Promise<ScoreRecord[]> {
    try {
      const db = await getDb();
      if (!db) {
        return this.getScoresFromLocal(count);
      }

      const q = query(
        collection(db, COLLECTION_NAME),
        orderBy('score', 'desc'),
        limit(count)
      );

      const snapshot = await getDocs(q);
      return snapshot.docs.map(doc => {
          const data = doc.data();
          return {
              ...data,
              createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : data.createdAt
          } as ScoreRecord;
      });
    } catch (error) {
      console.error('Error fetching scores from Firebase, falling back to local:', error);
      return this.getScoresFromLocal(count);
    }
  },

  saveScoreToLocal(record: Omit<ScoreRecord, 'createdAt'>) {
    const saved = localStorage.getItem('mathZumaLeaderboard');
    let leaderboard: ScoreRecord[] = saved ? JSON.parse(saved) : [];
    leaderboard.push(record);
    leaderboard.sort((a, b) => b.score - a.score);
    leaderboard = leaderboard.slice(0, 50); // Keep more locally
    localStorage.setItem('mathZumaLeaderboard', JSON.stringify(leaderboard));
  },

  getScoresFromLocal(count: number = 10): ScoreRecord[] {
    const saved = localStorage.getItem('mathZumaLeaderboard');
    if (!saved) return [];
    try {
      const records = JSON.parse(saved) as ScoreRecord[];
      return records.slice(0, count);
    } catch (e) {
      return [];
    }
  }
};
