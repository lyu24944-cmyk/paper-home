import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../lib/i18n'
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
  const { tr, locale } = useI18n()
  const inputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const latestAssetIdsRef = useRef(assetIds)
  latestAssetIdsRef.current = assetIds
  const uploadingRef = useRef(false)
  const uploadAbortRef = useRef<AbortController | null>(null)
  const onUploadStateChangeRef = useRef(onUploadStateChange)
  onUploadStateChangeRef.current = onUploadStateChange
  const [uploading, setUploading] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      uploadAbortRef.current?.abort()
      if (uploadingRef.current) {
        uploadingRef.current = false
        onUploadStateChangeRef.current?.(false)
      }
    }
  }, [])

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    uploadAbortRef.current?.abort()
    const task = new AbortController()
    uploadAbortRef.current = task
    uploadingRef.current = true
    setUploading(true)
    onUploadStateChange?.(true)
    setError('')
    setStatus(
      locale === 'en'
        ? `Compressing & uploading ${files.length} image(s)…`
        : `正在压缩并上传 ${files.length} 张图片…`,
    )

    const added: string[] = []
    const errors: string[] = []

    for (const file of Array.from(files)) {
      if (!mountedRef.current) break
      try {
        const { asset } = await processAndUploadImage(file, task.signal)
        if (!mountedRef.current || task.signal.aborted) break
        onAssetUploaded(asset)
        added.push(asset.id)
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : tr('上传失败', 'Upload failed')}`)
      }
    }

    if (!mountedRef.current || task.signal.aborted || uploadAbortRef.current !== task) return

    if (added.length > 0) {
      const current = latestAssetIdsRef.current
      onChange(multiple ? [...current, ...added] : [added[added.length - 1]])
      setStatus(
        locale === 'en'
          ? `Uploaded ${added.length} image(s) (display & thumbnail ready).`
          : `已上传 ${added.length} 张图片（已自动生成展示图与缩略图）。`,
      )
    } else {
      setStatus('')
    }

    if (errors.length > 0) {
      setError(errors.join(locale === 'en' ? '; ' : '；'))
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
          <span>
            {uploading
              ? tr('上传中…', 'Uploading…')
              : multiple
                ? tr('添加图片', 'Add Images')
                : assetIds.length
                  ? tr('替换图片', 'Replace Image')
                  : tr('选择图片', 'Choose Image')}
          </span>
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
              <SignedImage assetId={id} scope="admin" variant="thumb" alt={tr(`已选图片 ${idx + 1}`, `Selected image ${idx + 1}`)} />
              <div className="picked-image-actions">
                {multiple && idx > 0 && (
                  <button
                    type="button"
                    aria-label={tr('前移图片', 'Move image earlier')}
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
                  aria-label={tr('移除图片', 'Remove image')}
                  disabled={disabled || uploading}
                  onClick={() => onChange(assetIds.filter((x) => x !== id))}
                >
                  {tr('移除', 'Remove')}
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
  const { tr, locale } = useI18n()
  const generation = useRef(0)
  const validationAbort = useRef<AbortController | null>(null)
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
      generation.current++
      validationAbort.current?.abort()
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
    const task = ++generation.current
    validationAbort.current?.abort()
    const abort = new AbortController()
    validationAbort.current = abort
    const valid = () => mountedRef.current && generation.current === task && !abort.signal.aborted
    setPendingFile(file)
    setPhase('checking')
    setProgress(0)
    setError('')
    setStatus(tr('正在检查视频格式、大小与可播放性…', 'Checking video format, size & playability…'))
    busyRef.current = true
    onUploadStateChange?.(true)

    try {
      const controller = await createResumableVideoUpload(file, {
        onProgress: (pct, uploaded, total) => {
          if (!valid()) return
          setPhase('uploading')
          setProgress(pct)
          setStatus(
            locale === 'en'
              ? `Resumable upload ${pct}% (${(uploaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB)`
              : `可恢复上传中 ${pct}%（${(uploaded / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB）`,
          )
        },
        onSuccess: (asset) => {
          if (!valid()) return
          controllerRef.current = null
          busyRef.current = false
          setPendingFile(null)
          setPhase('idle')
          setProgress(100)
          setStatus(tr('视频上传并校验完成。', 'Video uploaded & verified.'))
          setError('')
          onAssetUploaded(asset)
          onChange(asset.id)
          onUploadStateChange?.(false)
        },
        onError: (msg) => {
          if (!valid()) return
          controllerRef.current = null
          busyRef.current = false
          setPhase('error')
          setError(msg)
          setStatus('')
          onUploadStateChange?.(false)
        },
      }, abort.signal)
      if (!valid()) {
        void controller.cancel()
        return
      }
      controllerRef.current = controller
      setPhase('uploading')
      setStatus(tr('开始上传视频…', 'Starting video upload…'))
      controller.start()
    } catch (err) {
      if (!valid()) return
      controllerRef.current = null
      busyRef.current = false
      setPhase('error')
      setStatus('')
      setError(err instanceof Error ? err.message : tr('视频校验失败。', 'Video validation failed.'))
      onUploadStateChange?.(false)
    }
  }

  async function handleCancel() {
    const task = ++generation.current
    validationAbort.current?.abort()
    const controller = controllerRef.current
    controllerRef.current = null
    busyRef.current = false
    setPendingFile(null)
    setPhase('idle')
    setProgress(0)
    setError('')
    setStatus(tr('已取消本次视频上传（其余文字内容已保留）。', 'Video upload cancelled (your text edits are kept).'))
    onUploadStateChange?.(false)
    if (inputRef.current) inputRef.current.value = ''
    await controller?.cancel()
    if (generation.current !== task) return
  }

  return (
    <div className="media-picker-block">
      <div className="media-picker-head">
        <div>
          <strong>{tr('演示视频（可选）', 'Demo Video (Optional)')}</strong>
          <small>{tr('支持 MP4 / WebM，单个上限 50 MB；仅在点击播放后加载', 'MP4 / WebM up to 50 MB; loaded only when clicked')}</small>
        </div>
        <button
          type="button"
          className="cms-ghost-btn"
          disabled={disabled || phase === 'checking' || phase === 'uploading'}
          onClick={() => inputRef.current?.click()}
        >
          <Icon name="play" size={15} />
          <span>{videoAssetId ? tr('更换视频', 'Replace Video') : tr('选择视频', 'Choose Video')}</span>
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
              {tr('取消上传', 'Cancel Upload')}
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
                {tr('重试上传（同一浏览器断点续传）', 'Retry Upload (resumable)')}
              </button>
              <button type="button" className="cms-ghost-btn" onClick={() => void handleCancel()}>
                {tr('放弃该视频', 'Discard Video')}
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
            {tr('已关联视频：', 'Attached video: ')}
            {assetInfo?.originalFilename || tr('演示视频', 'Demo Video')}
            {assetInfo?.byteSize ? ` · ${(assetInfo.byteSize / 1048576).toFixed(1)} MB` : ''}
            {assetInfo?.durationSec ? (locale === 'en' ? ` · ${Math.round(assetInfo.durationSec)}s` : ` · ${Math.round(assetInfo.durationSec)} 秒`) : ''}
          </span>
          <button
            type="button"
            className="cms-ghost-btn"
            disabled={phase === 'uploading'}
            onClick={() => onChange(null)}
          >
            {tr('移除视频', 'Remove Video')}
          </button>
        </div>
      )}
    </div>
  )
}
