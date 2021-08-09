import {
  CharacteristicEventTypes,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  PlatformAccessory,
  Service,
} from 'homebridge';

import { NatureRemoPlatform } from './platform';

export class NatureNemoAirConAccessory {
  private readonly name: string;
  private readonly id: string;
  private readonly deviceId: string;

  private state = {
    targetHeatingCoolingState: this.platform.Characteristic.TargetHeatingCoolingState.OFF,
    rotationSpeed: 'auto',
    targetTemperature: 24,
  };

  constructor(
    private readonly platform: NatureRemoPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.name = accessory.context.appliance.nickname;
    this.id = accessory.context.appliance.id;
    this.deviceId = accessory.context.appliance.device.id;

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Nature Inc.')
      .setCharacteristic(this.platform.Characteristic.Model, 'Nature Remo series')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.id);

    const thermostatService
      = this.accessory.getService(this.platform.Service.Thermostat) || this.accessory.addService(this.platform.Service.Thermostat);
    thermostatService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.appliance.nickname);

    thermostatService.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, this.getCurrentHeatingCoolingState.bind(this));
    thermostatService.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .on(CharacteristicEventTypes.GET, this.getTargetHeatingCoolingState.bind(this))
      .on(CharacteristicEventTypes.SET, this.setTargetHeatingCoolingState.bind(this));
    thermostatService.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .on(CharacteristicEventTypes.GET, this.getCurrentTemperature.bind(this));
    thermostatService.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .on(CharacteristicEventTypes.GET, this.getTargetTemperature.bind(this))
      .on(CharacteristicEventTypes.SET, this.setTargetTemperature.bind(this));
    thermostatService.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .on(CharacteristicEventTypes.GET, this.getTemperatureDisplayUnits.bind(this))
      .on(CharacteristicEventTypes.SET, this.setTemperatureDisplayUnits.bind(this));

    let fanSpeeds = accessory.context.appliance.aircon?.range?.modes?.cool?.vol;
    if(!fanSpeeds) {
      fanSpeeds = accessory.context.appliance.aircon?.range?.modes?.warm?.vol;
    }

    if(fanSpeeds) {
      const fanService
        = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
      this.accessory.context.speeds = fanSpeeds;
      
      const fanSpeedStep = this.getFanSpeedStep(fanSpeeds);

      this.accessory.context.fanSpeedStep = fanSpeedStep;

      fanService.setCharacteristic(this.platform.Characteristic.Name, 'Fan Speed');
      fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
        .on(CharacteristicEventTypes.GET, this.getRotationSpeed.bind(this))
        .on(CharacteristicEventTypes.SET, this.setRotationSpeed.bind(this))
        .props.minStep = fanSpeedStep;
    }
    

    // this.platform.logger('WAT ', accessory.context.appliance.aircon.range.modes);

    // if(accessory.context.appliance.aircon?.range?.modes?.dry) {
    //   this.platform.logger('Supports dry mode');
    //   this.service.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
    //     .on(CharacteristicEventTypes.GET, this.getHumidifierTargetStatus.bind(this))
    //     .on(CharacteristicEventTypes.SET, this.setHumidifierTargetStatus.bind(this))
    //     .props.validValues = [2];
    // }


    this.platform.logger.debug('[%s] id -> %s', accessory.context.appliance.nickname, accessory.context.appliance.id);
    
  }

  


  private getFanSpeedStep(fanSpeeds: Array<string>) {
    return parseFloat(
      (100 / fanSpeeds.length).toFixed(2),
    );
  }

  getRotationSpeed(callback: CharacteristicGetCallback): void {
    this.platform.logger.debug('getRotationSpeed called');
    this.platform.natureRemoApi.getAirConState(this.id).then((airConState) => {
      this.platform.logger.info('[%s] Target Rotation Speed -> %s', this.name, airConState.vol);
      if(airConState.vol) {
        this.state.rotationSpeed = airConState.vol;
        const homeKitRotationSpeed = this.natureToHomeKitRotationSpeed(airConState.vol, this.accessory.context.speeds);
        
        callback(null, homeKitRotationSpeed);
      } else {
        callback(new Error('Rotation speed not returned in current state'));
      }
    }).catch((err) => {
      this.platform.logger.error(err.message);
      callback(err);
    });
  }

  setRotationSpeed(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    const targetRotationSpeed = this.homekitToNatureRotationSpeed(value as number, this.accessory.context.speeds);
    if(this.state.rotationSpeed === targetRotationSpeed) {
      callback(null);
    } else {
      this.state.rotationSpeed = targetRotationSpeed;
      this.platform.natureRemoApi.setAirconRotationSpeed(this.id, targetRotationSpeed).then(() => {
        this.platform.logger.info('[%s] Target Rotation Speed <- %s (%s)', this.name, targetRotationSpeed, value);
        callback(null);
      }).catch((err) => {
        this.platform.logger.error(err.message);
        callback(err);
      });
    }
  }

  getCurrentHeatingCoolingState(callback: CharacteristicGetCallback): void {
    this.platform.logger.debug('getCurrentHeatingCoolingState called');
    this.platform.natureRemoApi.getAirConState(this.id).then((airConState) => {
      this.platform.logger.info('[%s] Current Heater Cooler State -> %s, %s', this.name, airConState.on, airConState.mode);
      const state = this.convertHeatingCoolingState(airConState.on, airConState.mode);
      callback(null, state);
    }).catch((err) => {
      this.platform.logger.error(err.message);
      callback(err);
    });
  }

  getTargetHeatingCoolingState(callback: CharacteristicGetCallback): void {
    this.platform.logger.debug('getTargetHeatingCoolingState called');
    this.platform.natureRemoApi.getAirConState(this.id).then((airConState) => {
      this.platform.logger.info('[%s] Target Heater Cooler State -> %s, %s', this.name, airConState.on, airConState.mode);
      const state = this.convertHeatingCoolingState(airConState.on, airConState.mode);
      this.state.targetHeatingCoolingState = state;
      callback(null, state);
    }).catch((err) => {
      this.platform.logger.error(err.message);
      callback(err);
    });
  }

  setTargetHeatingCoolingState(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.platform.logger.debug('setTargetHeatingCoolingState called ->', value);
    if (typeof value !== 'number') {
      callback(new Error('value must be a number'));
      return;
    }
    if (value === this.state.targetHeatingCoolingState) {
      this.platform.logger.debug('[%s] Same state. skip sending', this.name);
      callback(null);
      return;
    }
    this.state.targetHeatingCoolingState = value;
    if (value === this.platform.Characteristic.TargetHeatingCoolingState.AUTO) {
      const err = new Error('This plugin does not support auto');
      this.platform.logger.error(err.message);
      callback(err);
    } else if (value === this.platform.Characteristic.TargetHeatingCoolingState.OFF) {
      this.platform.natureRemoApi.setAirconPowerOff(this.id).then(() => {
        this.platform.logger.info('[%s] Target Heater Cooler State <- OFF', this.name);
        callback(null);
      }).catch((err) => {
        this.platform.logger.error(err.message);
        callback(err);
      });
    } else {
      const mode = this.convertOperationMode(value);
      this.platform.natureRemoApi.setAirconOperationMode(this.id, mode).then(() => {
        this.platform.logger.info('[%s] Target Heater Cooler State <- %s', this.name, mode);
        callback(null);
      }).catch((err) => {
        this.platform.logger.error(err.message);
        callback(err);
      });
    }
  }

  getCurrentTemperature(callback: CharacteristicGetCallback): void {
    this.platform.natureRemoApi.getSensorValue(this.deviceId).then((sensorValue) => {
      this.platform.logger.info('[%s] Current Temperature -> %s', this.name, sensorValue.te);
      callback(null, sensorValue.te);
    }).catch((err) => {
      this.platform.logger.error(err.message);
      callback(err);
    });
  }

  getTargetTemperature(callback: CharacteristicGetCallback): void {
    this.platform.logger.debug('getTargetTemperature called');
    this.platform.natureRemoApi.getAirConState(this.id).then((airConState) => {
      this.platform.logger.info('[%s] Target Temperature -> %s', this.name, airConState.temp);
      this.state.targetTemperature = parseFloat(airConState.temp);
      callback(null, airConState.temp);
    }).catch((err) => {
      this.platform.logger.error(err.message);
      callback(err);
    });
  }

  setTargetTemperature(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.platform.logger.debug('setTargetTemperature called ->', value);
    if (typeof value !== 'number') {
      callback(new Error('value must be a number'));
      return;
    }
    if (value === this.state.targetTemperature) {
      this.platform.logger.debug('[%s] Same state. skip sending', this.name);
      callback(null);
      return;
    }
    this.state.targetTemperature = value;
    const targetTemp = `${Math.round(value)}`;
    this.platform.natureRemoApi.setAirconTemperature(this.id, targetTemp).then(() => {
      this.platform.logger.info('[%s] Target Temperature <- %s', this.name, targetTemp);
      callback(null);
    }).catch((err) => {
      this.platform.logger.error(err.message);
      callback(err);
    });
  }

  getTemperatureDisplayUnits(callback: CharacteristicGetCallback): void {
    this.platform.logger.debug('getTemperatureDisplayUnits called');
    callback(null, this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS);
  }

  setTemperatureDisplayUnits(value: CharacteristicValue, callback: CharacteristicSetCallback): void {
    this.platform.logger.debug('setTemperatureDisplayUnits called ->', value);
    callback(null);
  }

  private convertHeatingCoolingState(on: boolean, mode: string): number {
    if (!on) {
      return this.platform.Characteristic.CurrentHeatingCoolingState.OFF;
    } else {
      if (mode === 'warm') {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      } else if (mode === 'cool') {
        return this.platform.Characteristic.CurrentHeatingCoolingState.COOL;
      } else if (mode === 'dry') {
        return this.platform.Characteristic.CurrentHeatingCoolingState.HEAT;
      } else {
        throw new Error(`This plugin does not support ${mode}`);
      }
    }
  }

  private natureToHomeKitRotationSpeed(speed: string, values: Array<string>) : number {
    return values.indexOf(speed) + 1 * this.getFanSpeedStep(values);
  }

  private homekitToNatureRotationSpeed(speed: number, values: Array<string>) : string {

    if(speed === 0) {
      return values[0];
    } else if (speed === 100){
      return values[values.length - 1];
    } else {
      return values[Math.round(speed / this.getFanSpeedStep(values)) - 1];
    }
  }

  private convertOperationMode(state: number): string {
    switch (state) {
      case this.platform.Characteristic.TargetHeatingCoolingState.HEAT:
        return 'warm';
      case this.platform.Characteristic.TargetHeatingCoolingState.COOL:
        return 'cool';
      default:
        throw new Error(`This plugin does not support ${state}`);
    }
  }
}
