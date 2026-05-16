
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';

let firestoreInstance: Firestore | null = null;
let initializationPromise: Promise<Firestore | null> | null = null;

export async function getDb(): Promise<Firestore | null> {
  if (firestoreInstance) return firestoreInstance;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    try {
      // @ts-ignore
      const config = await import('../../firebase-applet-config.json');
      const firebaseConfig = config.default;
      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
      
      // Initialize Firestore with the database ID if present in config
      firestoreInstance = getFirestore(app);
      
      console.log('Firebase initialized successfully from config');
      return firestoreInstance;
    } catch (e) {
      console.warn('Firebase configuration not found or failed to load. Global scores will be disabled.', e);
      return null;
    }
  })();

  return initializationPromise;
}

// For compatibility
export const db = null;
