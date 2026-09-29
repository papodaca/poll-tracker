import { Application } from '@hotwired/stimulus';
import HouseDistrictsController from './house_districts_controller.ts';

const application = Application.start();
application.register('house-districts', HouseDistrictsController);
