import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class CallFeaturesService {
  
  private baseUrl = '/api/livekit'; // This calls your backend server

  constructor(private http: HttpClient) { }

  // Get call features for a project
  getCallFeatures(projectId: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/features/${projectId}`);
  }

  // Update call features
  updateCallFeatures(projectId: string, features: any, plan: string = 'custom'): Observable<any> {
    return this.http.post(`${this.baseUrl}/update-agent-features`, {
      agent_id: projectId,
      features: features,
      plan: plan
    });
  }

  // Sync call features manually
  syncCallFeatures(projectId: string): Observable<any> {
    return this.http.post(`${this.baseUrl}/sync-agent`, {
      agent_id: projectId,
      source: 'dashboard'
    });
  }

  // Check specific permission
  checkPermission(projectId: string, permission: string): Observable<any> {
    return this.http.get(`${this.baseUrl}/check-permission`, {
      params: {
        agent_id: projectId,
        permission: permission
      }
    });
  }
}