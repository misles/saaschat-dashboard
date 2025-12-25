import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClientModule } from '@angular/common/http';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { CallControlsComponent } from './components/call-controls/call-controls.component';
import { CallRoomComponent } from './components/call-room/call-room.component';

@NgModule({
  declarations: [
    CallControlsComponent,
    CallRoomComponent
  ],
  imports: [
    CommonModule,
    FormsModule,
    HttpClientModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule
  ],
  exports: [
    CallControlsComponent,
    CallRoomComponent
  ]
})
export class LivekitModule { }