/**
 * Cursor — Blinking terminal cursor as an absolutely positioned DOM element.
 * Supports block, underline, and bar styles.
 */

export type CursorStyle = 'block' | 'underline' | 'bar';

export class TerminalCursor {
  private element: HTMLDivElement;
  private x = 0;
  private y = 0;
  private charWidth = 0;
  private lineHeight = 0;
  private style: CursorStyle = 'block';
  private blinkEnabled = true;

  constructor(container: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'dom-term-cursor';
    this.element.style.position = 'absolute';
    this.element.style.pointerEvents = 'none';
    this.element.style.zIndex = '10';
    this.element.style.willChange = 'left, top';
    this.applyBlink();
    container.appendChild(this.element);
  }

  setCharDimensions(charWidth: number, lineHeight: number): void {
    this.charWidth = charWidth;
    this.lineHeight = lineHeight;
    this.updateElementSize();
    this.updatePosition();
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.updatePosition();
  }

  setCursorStyle(style: CursorStyle): void {
    this.style = style;
    this.updateElementSize();
    this.updatePosition();
  }

  setColor(color: string): void {
    this.element.style.backgroundColor = color;
  }

  setVisible(visible: boolean): void {
    this.element.style.display = visible ? '' : 'none';
  }

  setBlink(enabled: boolean): void {
    this.blinkEnabled = enabled;
    this.applyBlink();
  }

  /** All position logic lives here — style-specific Y offsets applied */
  private updatePosition(): void {
    this.element.style.left = `${this.x * this.charWidth}px`;

    if (this.style === 'underline') {
      this.element.style.top = `${this.y * this.lineHeight + this.lineHeight - 2}px`;
    } else {
      this.element.style.top = `${this.y * this.lineHeight}px`;
    }
  }

  /** Size only — no position changes */
  private updateElementSize(): void {
    switch (this.style) {
      case 'block':
        this.element.style.width = `${this.charWidth}px`;
        this.element.style.height = `${this.lineHeight}px`;
        this.element.style.opacity = '0.6';
        break;
      case 'underline':
        this.element.style.width = `${this.charWidth}px`;
        this.element.style.height = '2px';
        this.element.style.opacity = '1';
        break;
      case 'bar':
        this.element.style.width = '2px';
        this.element.style.height = `${this.lineHeight}px`;
        this.element.style.opacity = '1';
        break;
    }
  }

  private applyBlink(): void {
    this.element.style.animationName = this.blinkEnabled ? 'dom-term-cursor-blink' : 'none';
    this.element.style.animationDuration = '1s';
    this.element.style.animationTimingFunction = 'step-end';
    this.element.style.animationIterationCount = 'infinite';
  }

  dispose(): void {
    this.element.remove();
  }
}
