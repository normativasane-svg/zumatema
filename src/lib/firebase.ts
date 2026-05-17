
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, Firestore, doc, getDocFromServer } from 'firebase/firestore';

let firestoreInstance: Firestore | null = null;
let initializationPromise: Promise<Firestore | null> | null = null;

async function testConnection(db: Firestore) {
  // Give the environment a moment to establish network
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  try {
    // Attempt to fetch to verify connection. Permission denied is a POSITIVE sign (it reached the server)
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log('Firebase: Connection verified successfully');
  } catch (error: any) {
    if (error?.code === 'permission-denied' || error?.code === 'not-found') {
      console.log('Firebase: Server reached successfully');
    } else if (error?.message?.includes('offline') || error?.code === 'unavailable') {
      console.warn('Firebase: Backend currently unreachable. It might be initializing or network is restricted.');
    } else {
      console.error('Firebase: Connection error:', error);
    }
  }
}

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
      
      // Perform connection test in background
      testConnection(firestoreInstance);
      
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
