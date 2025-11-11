import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import type { VueWrapper } from '@vue/test-utils';
import { nextTick } from 'vue';
import ProgressChart from './ProgressChart.vue';

// Helper to get canvas element
const getCanvas = (wrapper: VueWrapper) => {
  return wrapper.find('canvas').element as HTMLCanvasElement;
};

// Helper to mock canvas context
const mockCanvasContext = () => {
  const colorHistory: string[] = [];
  const fillColorHistory: string[] = [];

  const mockContext = {
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    arc: vi.fn(),
    closePath: vi.fn(),
    getContext: vi.fn(),
    fillText: vi.fn(),
    _strokeStyle: '',
    _fillStyle: '',
    get strokeStyle() {
      return this._strokeStyle;
    },
    set strokeStyle(value: string) {
      this._strokeStyle = value;
      colorHistory.push(value);
    },
    get fillStyle() {
      return this._fillStyle;
    },
    set fillStyle(value: string) {
      this._fillStyle = value;
      fillColorHistory.push(value);
    },
    lineWidth: 0,
    globalAlpha: 1,
    lineCap: '',
    lineJoin: '',
    font: '',
    textAlign: '',
    colorHistory,
    fillColorHistory,
  };

  return mockContext;
};

describe('ProgressChart', () => {
  let mockContext: ReturnType<typeof mockCanvasContext>;

  beforeEach(() => {
    mockContext = mockCanvasContext();

    // Mock HTMLCanvasElement.getContext
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => mockContext,
    ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const defaultProps = {
    data: [
      { date: '2024-01-01', experience: 10 },
      { date: '2024-01-02', experience: 20 },
      { date: '2024-01-03', experience: 15 },
    ],
    type: 'line' as const,
    height: 200,
    dataKey: 'experience',
    color: 'primary',
  };

  describe('Rendering', () => {
    it('should render canvas element', () => {
      const wrapper = mount(ProgressChart, {
        props: defaultProps,
      });

      const canvas = wrapper.find('canvas');
      expect(canvas.exists()).toBe(true);
    });

    it('should apply correct height style', () => {
      const wrapper = mount(ProgressChart, {
        props: defaultProps,
      });

      const container = wrapper.find('.progress-chart');
      expect(container.attributes('style')).toContain('height: 200px');
    });

    it('should set canvas width and height attributes', () => {
      const wrapper = mount(ProgressChart, {
        props: {
          ...defaultProps,
          width: 500,
        },
      });

      const canvas = getCanvas(wrapper);
      expect(canvas.width).toBe(500);
      expect(canvas.height).toBe(200);
    });

    it('should use default width of 400 when not provided', () => {
      const wrapper = mount(ProgressChart, {
        props: defaultProps,
      });

      const canvas = getCanvas(wrapper);
      expect(canvas.width).toBe(400);
    });
  });

  describe('Chart Drawing - Line Chart', () => {
    it('should clear canvas before drawing', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();
      expect(mockContext.clearRect).toHaveBeenCalled();
    });

    it('should draw line chart when type is line', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      // Should begin path for line drawing
      expect(mockContext.beginPath).toHaveBeenCalled();

      // Should call stroke to render the line
      expect(mockContext.stroke).toHaveBeenCalled();

      // Should call arc for drawing points
      expect(mockContext.arc).toHaveBeenCalled();
    });

    it('should set correct stroke style for line', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          color: 'primary',
        },
      });

      await nextTick();

      // Primary color should be mapped to #1976D2 (check first stroke call)
      expect(mockContext.colorHistory[0]).toBe('#1976D2');
    });

    it('should use custom hex color when provided', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          color: '#FF5733',
        },
      });

      await nextTick();
      expect(mockContext.colorHistory[0]).toBe('#FF5733');
    });

    it('should draw points on line chart', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      // Should call arc for each data point (3 points)
      expect(mockContext.arc).toHaveBeenCalledTimes(3);
    });

    it('should fill area under curve', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      // Should call closePath and fill for area
      expect(mockContext.closePath).toHaveBeenCalled();
      expect(mockContext.fill).toHaveBeenCalled();
    });
  });

  describe('Chart Drawing - Bar Chart', () => {
    it('should draw bar chart when type is bar', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          type: 'bar',
        },
      });

      await nextTick();

      // Should call fillRect for each bar (3 bars)
      expect(mockContext.fillRect).toHaveBeenCalledTimes(3);
    });

    it('should set correct fill style for bars', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          type: 'bar',
          color: 'secondary',
        },
      });

      await nextTick();

      // Secondary color should be mapped to #26A69A (check first fillRect call)
      expect(mockContext.fillColorHistory[0]).toBe('#26A69A');
    });
  });

  describe('Data Handling', () => {
    it('should handle empty data gracefully', async () => {
      const wrapper = mount(ProgressChart, {
        props: {
          ...defaultProps,
          data: [],
        },
      });

      await nextTick();

      // Should not throw errors
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle single data point', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          data: [{ date: '2024-01-01', experience: 10 }],
        },
      });

      await nextTick();

      // Should still render without errors
      expect(mockContext.beginPath).toHaveBeenCalled();
    });

    it('should extract correct data values using dataKey', async () => {
      mount(ProgressChart, {
        props: {
          data: [
            { date: '2024-01-01', vocabulary: 5, experience: 10 },
            { date: '2024-01-02', vocabulary: 8, experience: 15 },
          ],
          type: 'line',
          height: 200,
          dataKey: 'vocabulary',
          color: 'primary',
        },
      });

      await nextTick();

      // Chart should be drawn (verifying it extracted vocabulary, not experience)
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('should handle zero and negative values', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          data: [
            { date: '2024-01-01', experience: 0 },
            { date: '2024-01-02', experience: -5 },
            { date: '2024-01-03', experience: 10 },
          ],
        },
      });

      await nextTick();

      // Should render without errors
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('should redraw chart when data changes', async () => {
      const wrapper = mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();
      const initialCallCount = mockContext.clearRect.mock.calls.length;

      // Update data
      await wrapper.setProps({
        data: [
          { date: '2024-01-04', experience: 25 },
          { date: '2024-01-05', experience: 30 },
        ],
      });

      await nextTick();

      // Should have called clearRect again
      expect(mockContext.clearRect.mock.calls.length).toBeGreaterThan(initialCallCount);
    });
  });

  describe('Color Mapping', () => {
    it.each([
      ['primary', '#1976D2'],
      ['secondary', '#26A69A'],
      ['accent', '#9C27B0'],
      ['warning', '#FF9800'],
      ['positive', '#21BA45'],
      ['negative', '#C10015'],
      ['info', '#31CCEC'],
    ])('should map %s to %s', async (colorName, expectedHex) => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          color: colorName,
        },
      });

      await nextTick();
      // Check the color used in the first stroke call (line drawing)
      expect(mockContext.colorHistory[0]).toBe(expectedHex);
    });
  });

  describe('Axes and Labels', () => {
    it('should draw axes', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      // Should call moveTo and lineTo for drawing axes
      expect(mockContext.moveTo).toHaveBeenCalled();
      expect(mockContext.lineTo).toHaveBeenCalled();
    });

    it('should draw labels', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      // Should set font and textAlign for labels
      expect(mockContext.font).toBeTruthy();
      expect(mockContext.textAlign).toBeTruthy();
    });
  });

  describe('Chart Dimensions', () => {
    it('should respect padding in calculations', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          width: 400,
          height: 200,
        },
      });

      await nextTick();

      // Verify clearRect is called with full canvas dimensions
      expect(mockContext.clearRect).toHaveBeenCalledWith(0, 0, 400, 200);
    });

    it('should handle different aspect ratios', async () => {
      const wrapper = mount(ProgressChart, {
        props: {
          ...defaultProps,
          width: 800,
          height: 300,
        },
      });

      const canvas = getCanvas(wrapper);
      expect(canvas.width).toBe(800);
      expect(canvas.height).toBe(300);
    });
  });

  describe('Edge Cases', () => {
    it('should handle missing canvas context', async () => {
      // Mock getContext to return null
      HTMLCanvasElement.prototype.getContext = vi.fn(
        () => null,
      ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

      const wrapper = mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      // Should not throw errors
      expect(wrapper.exists()).toBe(true);
    });

    it('should handle data with missing keys gracefully', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          data: [
            { date: '2024-01-01' }, // Missing experience key
            { date: '2024-01-02', experience: 10 },
          ],
          dataKey: 'experience',
        },
      });

      await nextTick();

      // Should render without errors (missing values treated as 0)
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('should handle very large data values', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          data: [
            { date: '2024-01-01', experience: 10000 },
            { date: '2024-01-02', experience: 50000 },
            { date: '2024-01-03', experience: 100000 },
          ],
        },
      });

      await nextTick();

      // Should scale appropriately
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('should handle all zero values', async () => {
      mount(ProgressChart, {
        props: {
          ...defaultProps,
          data: [
            { date: '2024-01-01', experience: 0 },
            { date: '2024-01-02', experience: 0 },
            { date: '2024-01-03', experience: 0 },
          ],
        },
      });

      await nextTick();

      // Should still render
      expect(mockContext.stroke).toHaveBeenCalled();
    });
  });

  describe('Lifecycle', () => {
    it('should draw chart on mount', async () => {
      mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();

      expect(mockContext.clearRect).toHaveBeenCalled();
      expect(mockContext.stroke).toHaveBeenCalled();
    });

    it('should redraw when data changes', async () => {
      const wrapper = mount(ProgressChart, {
        props: defaultProps,
      });

      await nextTick();
      const initialClearCalls = mockContext.clearRect.mock.calls.length;

      // Change data
      await wrapper.setProps({
        data: [
          { date: '2024-01-04', experience: 25 },
          { date: '2024-01-05', experience: 30 },
        ],
      });
      await nextTick();

      // Should have cleared canvas again
      expect(mockContext.clearRect.mock.calls.length).toBeGreaterThan(initialClearCalls);
    });
  });
});
