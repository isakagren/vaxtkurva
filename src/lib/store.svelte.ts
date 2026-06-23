import { browser } from '$app/environment';

export interface Measurement {
  id: string;
  age: number; // Raw age entered by user
  ageUnit: 'weeks' | 'months'; // Age unit entered by user
  ageMonths: number; // Normalized age in months
  ageWeeks: number; // Normalized age in weeks
  weight: number | null; // Weight in kg
  length: number | null; // Length/height in cm
  hc: number | null; // Head circumference in cm
}

class AppState {
  gender = $state<'boy' | 'girl'>('boy');
  ageUnit = $state<'weeks' | 'months'>('months');
  measurements = $state<Measurement[]>([]);

  constructor() {
    if (browser) {
      const storedGender = localStorage.getItem('viktkurva_gender');
      if (storedGender === 'boy' || storedGender === 'girl') {
        this.gender = storedGender;
      }

      const storedAgeUnit = localStorage.getItem('viktkurva_age_unit');
      if (storedAgeUnit === 'weeks' || storedAgeUnit === 'months') {
        this.ageUnit = storedAgeUnit;
      }

      const storedMeasurements = localStorage.getItem('viktkurva_measurements');
      if (storedMeasurements) {
        try {
          this.measurements = JSON.parse(storedMeasurements);
        } catch (e) {
          console.error("Failed to parse measurements from localStorage", e);
        }
      }
    }
  }

  save() {
    if (browser) {
      localStorage.setItem('viktkurva_gender', this.gender);
      localStorage.setItem('viktkurva_age_unit', this.ageUnit);
      localStorage.setItem('viktkurva_measurements', JSON.stringify(this.measurements));
    }
  }

  setGender(g: 'boy' | 'girl') {
    this.gender = g;
    this.save();
  }

  setAgeUnit(unit: 'weeks' | 'months') {
    this.ageUnit = unit;
    this.save();
  }

  addMeasurement(m: Omit<Measurement, 'id' | 'ageMonths' | 'ageWeeks'>) {
    const WEEKS_TO_MONTHS = 1 / 4.3482;
    const MONTHS_TO_WEEKS = 4.3482;
    
    let ageMonths = 0;
    let ageWeeks = 0;

    if (m.ageUnit === 'weeks') {
      ageWeeks = m.age;
      ageMonths = m.age * WEEKS_TO_MONTHS;
    } else {
      ageMonths = m.age;
      ageWeeks = m.age * MONTHS_TO_WEEKS;
    }

    const newM: Measurement = {
      id: Math.random().toString(36).substring(2, 9),
      age: m.age,
      ageUnit: m.ageUnit,
      ageMonths,
      ageWeeks,
      weight: m.weight,
      length: m.length,
      hc: m.hc
    };

    this.measurements.push(newM);
    // Sort by age in months so they are in chronological order
    this.measurements.sort((a, b) => a.ageMonths - b.ageMonths);
    this.save();
  }

  deleteMeasurement(id: string) {
    this.measurements = this.measurements.filter(m => m.id !== id);
    this.save();
  }

  clearAll() {
    this.measurements = [];
    this.save();
  }
}

export const appState = new AppState();
