import { DEFAULT_VEHICLE, type VehicleConfig } from './VehicleModel';

/**
 * Hand-tuned car makes/models (NOT procedurally generated — we tune these by
 * feel). A profile is the physics config (the 12 VehicleModel fields) plus
 * identity (manufacturer + model + class) and the body silhouette it drives.
 * `stepVehicle` already takes a config, so the car you're driving just steps
 * with ITS profile — carjack a truck and it's a sluggish barge; a sports car is
 * nimble. GTA-style names so we can talk about them. One source of truth here.
 */
export type VehicleClass =
  | 'sedan'
  | 'compact'
  | 'sports'
  | 'super'
  | 'muscle'
  | 'truck'
  | 'van'
  | 'interceptor';

export interface CarProfile extends VehicleConfig {
  id: string;
  manufacturer: string;
  model: string;
  class: VehicleClass;
  shapeId: string; // a CAR_SHAPES id (the body silhouette)
}

/** Spread the baseline sedan config, override the fields that give a model its feel. */
const tune = (over: Partial<VehicleConfig>): VehicleConfig => ({ ...DEFAULT_VEHICLE, ...over });

/** The seven civilian makes/models you'll find on the street. */
export const PROFILES: CarProfile[] = [
  {
    id: 'crown-vantage', manufacturer: 'Crown', model: 'Vantage', class: 'sedan', shapeId: 'sedan',
    ...tune({}), // the balanced baseline
  },
  {
    id: 'komuter-bean', manufacturer: 'Komuter', model: 'Bean', class: 'compact', shapeId: 'compact',
    ...tune({ enginePower: 12, maxSpeed: 78, turnRate: 3.1, gripNormal: 11 }), // zippy, low top end
  },
  {
    id: 'velocci-strada', manufacturer: 'Velocci', model: 'Strada', class: 'sports', shapeId: 'sports',
    ...tune({ enginePower: 16, maxSpeed: 102, turnRate: 3.1, gripNormal: 12, gripSpeed: 11 }),
  },
  {
    id: 'velocci-furia', manufacturer: 'Velocci', model: 'Furia', class: 'super', shapeId: 'sports',
    ...tune({ enginePower: 19, brakePower: 40, maxSpeed: 118, turnRate: 3.0, gripNormal: 12.5, gripSpeed: 12 }),
  },
  {
    id: 'mosca-brute', manufacturer: 'Mosca', model: 'Brute', class: 'muscle', shapeId: 'sedan',
    ...tune({ enginePower: 17, maxSpeed: 99, turnRate: 2.4, gripNormal: 8, gripHandbrake: 0.6 }), // power, loose tail
  },
  {
    id: 'delivr-boxer', manufacturer: 'Delivr', model: 'Boxer', class: 'van', shapeId: 'van',
    ...tune({ enginePower: 10, maxSpeed: 74, turnRate: 2.1, gripNormal: 8 }),
  },
  {
    id: 'bunker-hauler', manufacturer: 'Bunker', model: 'Hauler', class: 'truck', shapeId: 'pickup',
    ...tune({ enginePower: 8, brakePower: 26, maxSpeed: 62, turnRate: 1.9, gripNormal: 7, gripSpeed: 12 }),
  },
];

/** Police interceptor — fast and planted, what cruisers (and a carjacked cop car) drive. */
export const INTERCEPTOR: CarProfile = {
  id: 'crown-interceptor', manufacturer: 'Crown', model: 'Interceptor', class: 'interceptor', shapeId: 'sports',
  ...tune({ enginePower: 15, maxSpeed: 94, turnRate: 2.9, gripNormal: 11 }),
};

/** The car you spawn in. */
export const PLAYER_PROFILE: CarProfile = PROFILES[0];
