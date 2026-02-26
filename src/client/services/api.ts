export const API_BASE = (window as any).__ZEUS_API_BASE__ || '/api';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

interface ApiError {
  code: string;
  message: string;
}

interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError;
}

class ApiClient {
  private baseUrl: string;
  private csrfToken: string | null = null;

  constructor(baseUrl: string = API_BASE) {
    this.baseUrl = baseUrl;
  }

  private async ensureCsrfToken(): Promise<void> {
    if (this.csrfToken) return;
    
    try {
      const response = await fetch(`${this.baseUrl}/csrf-token`, {
        method: 'GET',
        credentials: 'include',
      });
      const data = await response.json();
      this.csrfToken = data.data?.token || null;
    } catch {
      console.warn('Failed to fetch CSRF token');
    }
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<ApiResponse<T>> {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      await this.ensureCsrfToken();
    }

    const url = `${this.baseUrl}${path}`;
    
    const headers: Record<string, string> = {};

    const isFormData = body instanceof FormData;
    
    if (!isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    if (this.csrfToken && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) {
      headers['x-csrf-token'] = this.csrfToken;
    }

    const options: RequestInit = {
      method,
      headers,
      credentials: 'include',
    };

    if (body) {
      options.body = isFormData ? body : JSON.stringify(body);
    }

    const response = await fetch(url, options);
    const data = await response.json();

    if (!response.ok) {
      if (data.error?.code === 'CSRF_INVALID' || data.error?.code === 'CSRF_EXPIRED') {
        this.csrfToken = null;
        return this.request<T>(method, path, body);
      }
      throw {
        response: {
          data,
          status: response.status,
        },
        error: data.error,
      };
    }

    return data;
  }

  async get<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('GET', path);
  }

  async post<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('POST', path, body);
  }

  async put<T = unknown>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    return this.request<T>('PUT', path, body);
  }

  async delete<T = unknown>(path: string): Promise<ApiResponse<T>> {
    return this.request<T>('DELETE', path);
  }

  clearCsrfToken(): void {
    this.csrfToken = null;
  }
}

export const apiClient = new ApiClient();
