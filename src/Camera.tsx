import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Vector3 } from 'three'
import { PerspectiveCamera } from 'three'
import gsap from 'gsap'
import type { Place } from './content'
import { focusPoseForPlace, focusSubPose, galleryPose, hallPose, makeRoute, pose, stablePose, type CameraPose, type FocusSubPoseId, type TransitionState } from './layout'

export type PromoCameraWaypoint = { position: [number, number, number]; target: [number, number, number]; fov?: number }
export type CameraHandle = {
  travel: (target: Place, reduced: boolean, commit: () => void) => Promise<void>
  snapPlace?: (target: Place) => void
  glidePromo?: (from: PromoCameraWaypoint | null, to: PromoCameraWaypoint, durationSec: number, ease?: string) => Promise<void>
  clearPromoOverride?: () => void
}
export const CameraController = forwardRef<CameraHandle,{place:Place;busy:boolean;reduced:boolean;galleryIndex:number;galleryCount:number;focusId?:FocusSubPoseId|null;progress:React.MutableRefObject<number>;onTransition:(state:TransitionState|null)=>void}>(({place,busy,reduced,galleryIndex,galleryCount,focusId=null,progress,onTransition},ref)=>{
  const {camera:baseCamera,size}=useThree(),camera=baseCamera as PerspectiveCamera
  const active=useRef(false),promoOverride=useRef(false),focusTween=useRef<gsap.core.Tween|null>(null),smooth=useRef(progress.current),tween=useRef<gsap.core.Tween|null>(null),finishSegment=useRef<(()=>void)|null>(null),reducedRef=useRef(reduced)
  const dimensions=useRef(size),galleryRef=useRef({index:galleryIndex,count:galleryCount}),prevFocus=useRef<FocusSubPoseId|null>(null),placeRef=useRef(place),onTransitionRef=useRef(onTransition)
  dimensions.current=size;reducedRef.current=reduced;galleryRef.current={index:galleryIndex,count:galleryCount};placeRef.current=place;onTransitionRef.current=onTransition
  const apply=(p:CameraPose)=>{camera.position.copy(p.position);camera.quaternion.copy(p.orientation);camera.fov=p.fov;camera.updateProjectionMatrix()}
  const aspect=()=>dimensions.current.width/dimensions.current.height
  const targetPoseForCurrent=(p:Place,focus:FocusSubPoseId|null)=>{
    const validFocus=focusPoseForPlace(focus,p)
    return validFocus?focusSubPose(validFocus,aspect()):stablePose(p,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count)
  }
  useLayoutEffect(()=>{
    if(!active.current&&!focusTween.current&&!promoOverride.current){
      apply(targetPoseForCurrent(place,focusId))
    }
  },[place,size.width,size.height])
  useEffect(()=>{
    const validFocus=focusPoseForPlace(focusId,place)
    if(active.current){prevFocus.current=validFocus;return}
    if(prevFocus.current===validFocus){
      if(reduced&&focusTween.current){
        focusTween.current.kill();focusTween.current=null
        apply(targetPoseForCurrent(place,validFocus))
      }
      return
    }
    prevFocus.current=validFocus
    focusTween.current?.kill();focusTween.current=null
    const dest=targetPoseForCurrent(place,validFocus)
    if(reduced||document.hidden){
      apply(dest)
      return
    }
    const start={position:camera.position.clone(),orientation:camera.quaternion.clone(),fov:camera.fov},value={t:0}
    focusTween.current=gsap.to(value,{
      t:1,
      duration:.62,
      ease:'power2.out',
      onUpdate:()=>{
        camera.position.lerpVectors(start.position,dest.position,value.t)
        camera.quaternion.slerpQuaternions(start.orientation,dest.orientation,value.t)
        camera.fov=start.fov+(dest.fov-start.fov)*value.t
        camera.updateProjectionMatrix()
      },
      onComplete:()=>{
        focusTween.current=null
        apply(dest)
      },
    })
  },[focusId,place,reduced])
  useEffect(()=>{if(reduced&&active.current)finishSegment.current?.()},[reduced])
  useEffect(()=>{
    const visibility=()=>{if(document.hidden){finishSegment.current?.();focusTween.current?.kill();focusTween.current=null}}
    document.addEventListener('visibilitychange',visibility)
    return()=>{document.removeEventListener('visibilitychange',visibility);tween.current?.kill();focusTween.current?.kill();finishSegment.current?.()}
  },[])
  useImperativeHandle(ref,()=>({
    travel:async(target,quiet,commit)=>{
      promoOverride.current=false
      focusTween.current?.kill();focusTween.current=null;prevFocus.current=null
      active.current=true
      const from=placeRef.current,points=makeRoute(from,target,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count)
      try{
        for(let i=0;i<points.length;i++){
          const point=points[i]
          onTransitionRef.current({from,to:target,phase:point.phase,progress:i/points.length})
          if(quiet||reducedRef.current||document.hidden){apply(point.pose);continue}
          const start={position:camera.position.clone(),orientation:camera.quaternion.clone(),fov:camera.fov},value={t:0}
          await new Promise<void>(resolve=>{
            let ended=false
            const finish=()=>{if(ended)return;ended=true;clearTimeout(timer);tween.current?.kill();apply(point.pose);finishSegment.current=null;resolve()}
            const timer=setTimeout(finish,point.duration*1000+300)
            finishSegment.current=finish
            tween.current=gsap.to(value,{t:1,duration:point.duration,ease:'power2.inOut',onUpdate:()=>{
              camera.position.lerpVectors(start.position,point.pose.position,value.t)
              camera.quaternion.slerpQuaternions(start.orientation,point.pose.orientation,value.t)
              camera.fov=start.fov+(point.pose.fov-start.fov)*value.t;camera.updateProjectionMatrix()
              onTransitionRef.current({from,to:target,phase:point.phase,progress:(i+value.t)/points.length})
            },onComplete:finish})
          })
        }
        // Resize, reduced motion and background recovery share one deterministic endpoint.
        apply(stablePose(target,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count));smooth.current=progress.current
        onTransitionRef.current({from,to:target,phase:'complete',progress:1});commit()
      }finally{active.current=false;onTransitionRef.current(null)}
    },
    snapPlace:(target)=>{
      promoOverride.current=false
      finishSegment.current?.()
      tween.current?.kill();tween.current=null
      focusTween.current?.kill();focusTween.current=null
      prevFocus.current=null
      apply(stablePose(target,progress.current,aspect(),galleryRef.current.index,galleryRef.current.count))
      smooth.current=progress.current
      onTransitionRef.current(null)
    },
    glidePromo:async(from,to,durationSec,ease='power1.inOut')=>{
      promoOverride.current=true
      focusTween.current?.kill();focusTween.current=null
      tween.current?.kill();tween.current=null
      const makePose=(wp:PromoCameraWaypoint)=>pose(wp.position,wp.target,wp.fov??camera.fov)
      const startPose=from?makePose(from):{position:camera.position.clone(),orientation:camera.quaternion.clone(),fov:camera.fov}
      const endPose=makePose(to)
      apply(startPose)
      if(durationSec<=0){apply(endPose);return}
      const lookStart=from?new Vector3(...from.target):null
      const lookEnd=new Vector3(...to.target)
      const curLook=new Vector3()
      const value={t:0}
      await new Promise<void>(resolve=>{
        tween.current=gsap.to(value,{
          t:1,
          duration:durationSec,
          ease,
          onUpdate:()=>{
            camera.position.lerpVectors(startPose.position,endPose.position,value.t)
            if(lookStart){
              curLook.lerpVectors(lookStart,lookEnd,value.t)
              camera.lookAt(curLook)
            }else{
              camera.quaternion.slerpQuaternions(startPose.orientation,endPose.orientation,value.t)
            }
            camera.fov=startPose.fov+(endPose.fov-startPose.fov)*value.t
            camera.updateProjectionMatrix()
          },
          onComplete:()=>{
            apply(endPose)
            tween.current=null
            resolve()
          },
        })
      })
    },
    clearPromoOverride:()=>{
      promoOverride.current=false
      tween.current?.kill();tween.current=null
    },
  }),[])
  useFrame((_,dt)=>{
    if(promoOverride.current)return
    if(!active.current&&!busy&&place==='hall'){
      smooth.current=reduced?progress.current:smooth.current+(progress.current-smooth.current)*(1-Math.exp(-Math.min(dt,.1)*9))
      apply(hallPose(smooth.current,aspect()))
    }
    if(!active.current&&!busy&&place==='gallery'&&aspect()<=.8){
      const target=galleryPose(galleryIndex,galleryCount),alpha=reduced?1:1-Math.exp(-Math.min(dt,.1)*12)
      camera.position.lerp(target.position,alpha);camera.quaternion.slerp(target.orientation,alpha)
      camera.fov=target.fov;camera.updateProjectionMatrix()
    }
  })
  return null
})
