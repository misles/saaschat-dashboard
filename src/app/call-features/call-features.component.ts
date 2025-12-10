import { Component, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

// Services
import { CallFeaturesService } from '../services/call-features.service';
import { LoggerService } from '../services/logger/logger.service';

// Models
import { CallFeatures, CallFeaturesResponse } from '../models/call-features-model';

@Component({
  selector: 'appdashboard-call-features',
  templateUrl: './call-features.component.html',
  styleUrls: ['./call-features.component.scss']
})
export class CallFeaturesComponent implements OnInit, OnDestroy {
  private unsubscribe$: Subject<void> = new Subject<void>();

  projectId: string;
  isLoading = true;
  isSaving = false;
  isSyncing = false;
  
  callFeaturesForm: FormGroup;
  currentFeatures: CallFeatures;
  lastSyncTime: string;
  plan: string = 'starter';
  source: string = '';

  constructor(
    private route: ActivatedRoute,
    private router: Router,
    private fb: FormBuilder,
    private callFeaturesService: CallFeaturesService,
    private logger: LoggerService,
    private snackBar: MatSnackBar
  ) {
    this.createForm();
  }

  ngOnInit(): void {
    this.getProjectId();
    this.loadCallFeatures();
  }

  ngOnDestroy(): void {
    this.unsubscribe$.next();
    this.unsubscribe$.complete();
  }

  private getProjectId(): void {
    this.route.parent?.params
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe(params => {
        this.projectId = params['projectid'];
        this.logger.log('[CALL-FEATURES] Project ID:', this.projectId);
      });
  }

  private createForm(): void {
    this.callFeaturesForm = this.fb.group({
      audio: [false],
      video: [false],
      screen_share: [false],
      image_share: [false],
      file_share: [false],
      max_participants: [2, [Validators.required, Validators.min(1), Validators.max(50)]],
      max_call_minutes: [0, [Validators.min(0), Validators.max(1440)]]
    });
  }

  private loadCallFeatures(): void {
    if (!this.projectId) {
      this.isLoading = false;
      return;
    }

    this.callFeaturesService.getCallFeatures(this.projectId)
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe({
        next: (response: CallFeaturesResponse) => {
          this.logger.log('[CALL-FEATURES] Loaded features:', response);
          
          this.currentFeatures = response.features;
          this.plan = response.plan;
          this.source = response.source;
          this.lastSyncTime = response.synced_at;
          
          // Update form with loaded values
          this.callFeaturesForm.patchValue(response.features);
          this.isLoading = false;
        },
        error: (error) => {
          this.logger.error('[CALL-FEATURES] Error loading features:', error);
          this.showSnackBar('Error loading call features', 'error');
          this.isLoading = false;
        }
      });
  }

  saveCallFeatures(): void {
    if (this.callFeaturesForm.invalid || !this.projectId || this.isSaving) {
      return;
    }

    this.isSaving = true;
    const features = this.callFeaturesForm.value;

    this.callFeaturesService.updateCallFeatures(this.projectId, features, this.plan)
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe({
        next: (response) => {
          this.logger.log('[CALL-FEATURES] Features saved:', response);
          this.showSnackBar('Call features saved successfully!', 'success');
          this.isSaving = false;
          this.loadCallFeatures(); // Reload to get updated data
        },
        error: (error) => {
          this.logger.error('[CALL-FEATURES] Error saving features:', error);
          this.showSnackBar('Error saving call features', 'error');
          this.isSaving = false;
        }
      });
  }

  syncCallFeatures(): void {
    if (!this.projectId || this.isSyncing) {
      return;
    }

    this.isSyncing = true;
    this.callFeaturesService.syncCallFeatures(this.projectId)
      .pipe(takeUntil(this.unsubscribe$))
      .subscribe({
        next: (response) => {
          this.logger.log('[CALL-FEATURES] Features synced:', response);
          this.showSnackBar('Call features synced successfully!', 'success');
          this.isSyncing = false;
          this.loadCallFeatures(); // Reload to get updated data
        },
        error: (error) => {
          this.logger.error('[CALL-FEATURES] Error syncing features:', error);
          this.showSnackBar('Error syncing call features', 'error');
          this.isSyncing = false;
        }
      });
  }

  goBack(): void {
    this.router.navigate(['project', this.projectId]);
  }

  private showSnackBar(message: string, type: 'success' | 'error'): void {
    this.snackBar.open(message, 'Close', {
      duration: 3000,
      panelClass: type === 'success' ? 'success-snackbar' : 'error-snackbar'
    });
  }

  // Form getters for easy access in template
  get audio() { return this.callFeaturesForm.get('audio'); }
  get video() { return this.callFeaturesForm.get('video'); }
  get screen_share() { return this.callFeaturesForm.get('screen_share'); }
  get image_share() { return this.callFeaturesForm.get('image_share'); }
  get file_share() { return this.callFeaturesForm.get('file_share'); }
  get max_participants() { return this.callFeaturesForm.get('max_participants'); }
  get max_call_minutes() { return this.callFeaturesForm.get('max_call_minutes'); }
}