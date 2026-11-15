import { useEffect, useRef, useState } from 'react'
import {
  createResumableVideoUpload,
  processAndUploadImage,
  type VideoUploadController,
} from '../lib/media'
import type { MediaAsset } from '../types/content'
import { SignedImage } from './SignedImage'
import { Icon } from './Icon'

export function ImageListPicker({
  label,
  hint,
  assetIds,
  multiple = false,
  disabled = false,
  onChange,
  onAssetUploaded,
  onUploadStateChange,
}: {
  label: string
  hint: string
  assetIds: string[]
  multiple?: boolean
  disabled?: boolean
  onChange: (nextIds: string[]) => void
  onAssetUploaded: (asset: MediaAsset) => void
  onUploadStateChange?: (busy: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const latestAssetIdsRef = useRef(assetIds)
  latestAssetIdsRef.current = assetIds
  const uploadingRef = useRef(false)
  const onUploadStateChangeRef = useRef(onUploadStateChange)
  onUploadStateChangeRef.current = onUploadStateChange
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (uploadingRef.current) {
        uploadingRef.current = false
        onUploadStateChangeRef.current?.(false)
      }
    }
  }, [])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    uploadingRef.current = true
    setUploading(true)
    onUploadStateChange?.(true)
    setError('')
    setStatus(`正在压缩并上传 ${files.length} 张图片…`)

    const added: string[] = []
    const errors: string[] = []

    for (const file of Array.from(files)) {
      if (!mountedRef.current) break
      try {
        const { asset } = await processAndUploadImage(file)
        if (!mountedRef.current) break
        onAssetUploaded(asset)
        added.push(asset.id)
      } catch (err) {
        errors.push(`${file.name}：${err instanceof Error ? err.message : '上传失败'}`)
      }
    }

    if (!mountedRef.current) return

    if (added.length > 0) {
      const current = latestAssetIdsRef.current
      onChange(multiple ? [...current, ...added] : [added[added.length - 1]])
      setStatus(`已上传 ${added.length} 张图片（已自动生成展示图与缩略图）。`)
    } else {
      setStatus('')
    }

    if (errors.length > 0) {
      setError(errors.join('；'))
    }

    if (inputRef.current) inputRef.current.value = ''
    uploadingRef.current = false
    setUploading(false)
    onUploadStateChange?.(false)
  }

  return (
    <div className="media-picker-block">
      <div className="media-picker-head">
        <div>
          <strong>{label}</strong>
          <small>{hint}</small>
        </div>
        <button
          type="button"
          className="cms-ghost-btn"
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="plus" size={15} />
          <span>{uploading ? '上传中…' : multiple ? '添加图片' : assetIds.length ? '替换图片' : '选择图片'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple={multiple}
          hidden
          onChange={(e) => void handleFiles(e.target.files)}
        />
      </div>

      {status && <p className="upload-status-text" role="status">{status}</p>}
      {error && <p className="cms-error-inline" role="alert">{error}</p>}

      {assetIds.length > 0 && (
        <div className="picked-image-grid">
          {assetIds.map((id, idx) => (
            <div key={id} className="picked-image-card">
              <SignedImage assetId={id} scope="admin" variant="thumb" alt={`已选图片 ${idx + 1}`} />
              <div className="picked-image-actions">
                {multiple && idx > 0 && (
                  <button
                    type="button"
                    aria-label="前移图片"
                    disabled={disabled || uploading}
                    onClick={() => {
                      const next = [...assetIds]
                      ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
                      onChange(next)
                    }}
                  >
                    ←
                  </button>
                )}
                <button
                  type="button"
                  aria-label="移除图片"
                  disabled={disabled || uploading}
                  onClick={() => onChange(assetIds.filter((x) => x !== id))}
                >
                  移除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function VideoUploadPicker({
  videoAssetId,
  assetInfo,
  disabled = false,
  onChange,
  onAssetUploaded,
  onUploadStateChange,
}: {
  videoAssetId: string | null
  assetInfo?: MediaAsset | null
  disabled?: boolean
  onChange: (nextId: string | null) => void
  onAssetUploaded: (asset: MediaAsset) => void
  onUploadStateChange?: (busy: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const controllerRef = useRef<VideoUploadController | null>(null)
  const mountedRef = useRef(true)
  const busyRef = useRef(false)
  const onUploadStateChangeRef = useRef(onUploadStateChange)
  onUploadStateChangeRef.current = onUploadStateChange
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<'idle' | 'checking' | 'uploading' | 'error'>('idle')
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      if (controllerRef.current) {
        void controllerRef.current.cancel()
        controllerRef.current = null
      }
      if (busyRef.current) {
        busyRef.current = false
        onUploadStateChangeRef.current?.(false)
      }
    }
  }, [])

  async function beginUpload(file: File) {
    setPendingFile(file)
    setPhase('checking')
    setProgress(0)
    setError('')
    setStatus('正在检查视频格式、大小与可播放性…')
    busyRef.current = true
    onUploadStateChange?.(true)

    try {
      const controller = await createResumableVideoUpload(file, {
        onProgress: (pct, uploaded, total) => {
          if (!mountedRef.current) return
          setPhase('uploading')
          setProgress(pct)
          setStatus(
            `可恢复上传中 ${pct}%（${(uploaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB）`,
          )
        },
        onSuccess: (asset) => {
          controllerRef.current = null
          busyRef.current = false
          if (!mountedRef.current) {
            onUploadStateChange?.(false)
            return
          }
          setPendingFile(null)
          setPhase('idle')
          setProgress(100)
          setStatus('视频上传并校验完成。')
          setError('')
          onAssetUploaded(asset)
          onChange(asset.id)
          onUploadStateChange?.(false)
        },
        onError: (msg) => {
          controllerRef.current = null
          busyRef.current = false
          if (!mountedRef.current) {
            onUploadStateChange?.(false)
            return
          }
          setPhase('error')
          setError(msg)
          setStatus('')
          onUploadStateChange?.(false)
        },
      })
      if (!mountedRef.current) {
        void controller.cancel()
        busyRef.current = false
        onUploadStateChange?.(false)
        return
      }
      controllerRef.current = controller
      setPhase('uploading')
      setStatus('开始上传视频…')
      controller.start()
    } catch (err) {
      controllerRef.current = null
      busyRef.current = false
      if (!mountedRef.current) {
        onUploadStateChange?.(false)
        return
      }
      setPhase('error')
      setStatus('')
      setError(err instanceof Error ? err.message : '视频校验失败。')
      onUploadStateChange?.(false)
    }
  }

  async function handleCancel() {
    await controllerRef.current?.cancel()
    controllerRef.current = null
    busyRef.current = false
    if (!mountedRef.current) return
    setPendingFile(null)
    setPhase('idle')
    setProgress(0)
    setError('')
    setStatus('已取消本次视频上传（其余文字内容已保留）。')
    onUploadStateChange?.(false)
    if (inputRef.current) inputRef.current.value = ''
  }

  return (
    <div className="media-picker-block">
      <div className="media-picker-head">
        <div>
          <strong>演示视频（可选）</strong>
          <small>支持 MP4 / WebM，单个上限 50 MB；仅在点击播放后加载</small>
        </div>
        <button
          type="button"
          className="cms-ghost-btn"
          disabled={disabled || phase === 'checking' || phase === 'uploading'}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="play" size={15} />
          <span>{videoAssetId ? '更换视频' : '选择视频'}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="video/mp4,video/webm"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void beginUpload(file)
            e.target.value = ''
          }}
        />
      </div>

      {(phase === 'checking' || phase === 'uploading') && (
        <div className="video-upload-progress">
          <div className="progress-track" aria-hidden="true">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="video-upload-bar-row">
            <span role="status">{status}</span>
            <button type="button" className="cms-ghost-btn" onClick={() => void handleCancel()}>
              取消上传
            </button>
          </div>
        </div>
      )}

      {phase === 'error' && error && (
        <div className="video-upload-error">
          <p className="cms-error-inline" role="alert">{error}</p>
          {pendingFile && (
            <div className="video-upload-bar-row">
              <button type="button" className="cms-ghost-btn" onClick={() => void beginUpload(pendingFile)}>
                重试上传（同一浏览器断点续传）
              </button>
              <button type="button" className="cms-ghost-btn" onClick={() => void handleCancel()}>
                放弃该视频
              </button>
            </div>
          )}
        </div>
      )}

      {phase === 'idle' && status && !error && (
        <p className="upload-status-text" role="status">{status}</p>
      )}

      {videoAssetId && (
        <div className="picked-video-chip">
          <span>
            已关联视频：
            {assetInfo?.originalFilename || '演示视频'}
            {assetInfo?.byteSize ? ` · ${(assetInfo.byteSize / 1048576).toFixed(1)} MB` : ''}
            {assetInfo?.durationSec ? ` · ${Math.round(assetInfo.durationSec)} 秒` : ''}
          </span>
          <button
            type="button"
            className="cms-ghost-btn"
            disabled={phase === 'uploading'}
            onClick={() => onChange(null)}
          >
            移除视频
          </button>
        </div>
      )}
    </div>
  )
}
